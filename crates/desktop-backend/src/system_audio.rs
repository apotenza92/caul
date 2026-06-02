use std::path::Path;
use std::sync::mpsc::Receiver;

use base64::Engine;
use susura_audio_core::{AudioLevel, AudioSource};

#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)]
pub enum SystemAudioUpdate {
    Started {
        sample_rate_hz: u32,
        channels: u16,
    },
    Stopped,
    Stage(String),
    Level(AudioLevel),
    AudioFrame {
        sample_rate_hz: u32,
        channels: u16,
        pcm16_base64: String,
    },
    TranscriptionCompleted(String),
    TranscriptionPartial(String),
    SpeechStarted,
    SpeechStopped,
    Error(String),
}

pub struct RunningSystemAudio {
    inner: PlatformRunningSystemAudio,
}

impl RunningSystemAudio {
    pub fn start(
        repository_root: impl AsRef<Path>,
        transcribe_parakeet: bool,
    ) -> Result<(Self, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>> {
        let (inner, receiver) = platform::start(repository_root.as_ref(), transcribe_parakeet)?;

        Ok((Self { inner }, receiver))
    }

    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[allow(dead_code)]
enum PlatformRunningSystemAudio {
    #[cfg(target_os = "macos")]
    Macos(susura_macos_capture::RunningCapture),
    #[cfg(target_os = "windows")]
    Cpal(cpal::Stream),
    #[cfg(target_os = "linux")]
    PipeWire(std::process::Child),
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Unsupported,
}

impl PlatformRunningSystemAudio {
    fn stop(&mut self) {
        match self {
            #[cfg(target_os = "macos")]
            Self::Macos(capture) => capture.stop(),
            #[cfg(target_os = "windows")]
            Self::Cpal(_) => {}
            #[cfg(target_os = "linux")]
            Self::PipeWire(child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            Self::Unsupported => {}
        }
    }
}

#[allow(dead_code)]
trait ToFloatSample {
    fn to_float_sample(self) -> f32;
}

impl ToFloatSample for f32 {
    fn to_float_sample(self) -> f32 {
        self.clamp(-1.0, 1.0)
    }
}

impl ToFloatSample for i16 {
    fn to_float_sample(self) -> f32 {
        self as f32 / i16::MAX as f32
    }
}

impl ToFloatSample for u16 {
    fn to_float_sample(self) -> f32 {
        (self as f32 - 32768.0) / 32768.0
    }
}

#[allow(dead_code)]
fn level_for_samples(samples: &[f32]) -> Option<AudioLevel> {
    if samples.is_empty() {
        return None;
    }

    let peak = samples.iter().fold(0.0_f32, |max, sample| max.max(sample.abs()));
    let sum_squares = samples.iter().map(|sample| sample * sample).sum::<f32>();
    let rms = (sum_squares / samples.len() as f32).sqrt();

    AudioLevel::new(AudioSource::System, peak.clamp(0.0, 1.0), rms.clamp(0.0, 1.0)).ok()
}

#[allow(dead_code)]
fn encode_pcm16_base64(samples: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(samples.len() * 2);

    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{PlatformRunningSystemAudio, SystemAudioUpdate};
    use std::path::Path;
    use std::sync::mpsc::{self, Receiver};
    use std::thread;

    pub fn start(
        repository_root: &Path,
        transcribe_parakeet: bool,
    ) -> Result<(PlatformRunningSystemAudio, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>>
    {
        let (capture, receiver) =
            susura_macos_capture::RunningCapture::start_system_audio(repository_root, transcribe_parakeet)?;
        let (sender, mapped_receiver) = mpsc::channel();

        thread::spawn(move || {
            for update in receiver {
                let mapped = match update {
                    susura_macos_capture::CaptureUpdate::Started {
                        sample_rate_hz,
                        channels,
                    } => SystemAudioUpdate::Started {
                        sample_rate_hz,
                        channels,
                    },
                    susura_macos_capture::CaptureUpdate::Stopped => SystemAudioUpdate::Stopped,
                    susura_macos_capture::CaptureUpdate::Stage(message) => {
                        SystemAudioUpdate::Stage(message)
                    }
                    susura_macos_capture::CaptureUpdate::SystemLevel(level) => {
                        SystemAudioUpdate::Level(level)
                    }
                    susura_macos_capture::CaptureUpdate::AudioFrame {
                        sample_rate_hz,
                        channels,
                        pcm16_base64,
                    } => SystemAudioUpdate::AudioFrame {
                        sample_rate_hz,
                        channels,
                        pcm16_base64,
                    },
                    susura_macos_capture::CaptureUpdate::TranscriptionCompleted(text) => {
                        SystemAudioUpdate::TranscriptionCompleted(text)
                    }
                    susura_macos_capture::CaptureUpdate::TranscriptionPartial(text) => {
                        SystemAudioUpdate::TranscriptionPartial(text)
                    }
                    susura_macos_capture::CaptureUpdate::SpeechStarted => {
                        SystemAudioUpdate::SpeechStarted
                    }
                    susura_macos_capture::CaptureUpdate::SpeechStopped => {
                        SystemAudioUpdate::SpeechStopped
                    }
                    susura_macos_capture::CaptureUpdate::Error(message) => {
                        SystemAudioUpdate::Error(message)
                    }
                };

                if sender.send(mapped).is_err() {
                    break;
                }
            }
        });

        Ok((PlatformRunningSystemAudio::Macos(capture), mapped_receiver))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{
        encode_pcm16_base64, level_for_samples, PlatformRunningSystemAudio, SystemAudioUpdate,
        ToFloatSample,
    };
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::path::Path;
    use std::sync::mpsc::{self, Receiver};

    pub fn start(
        _repository_root: &Path,
        _transcribe_parakeet: bool,
    ) -> Result<(PlatformRunningSystemAudio, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>>
    {
        let (sender, receiver) = mpsc::channel();
        let host = cpal::default_host();
        let device = system_audio_device(&host)?;
        let config = system_audio_config(&device)?;
        let sample_rate_hz = config.sample_rate();
        let channels = config.channels();
        let stream_config = config.config();
        let error_sender = sender.clone();
        let err_fn = move |error| {
            let _ = error_sender.send(SystemAudioUpdate::Error(format!(
                "System audio capture failed: {error}"
            )));
        };

        let _ = sender.send(SystemAudioUpdate::Stage(system_audio_started_message()));
        let _ = sender.send(SystemAudioUpdate::Started {
            sample_rate_hz,
            channels,
        });

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                build_system_input_stream::<f32>(&device, &stream_config, sender, err_fn)?
            }
            cpal::SampleFormat::I16 => {
                build_system_input_stream::<i16>(&device, &stream_config, sender, err_fn)?
            }
            cpal::SampleFormat::U16 => {
                build_system_input_stream::<u16>(&device, &stream_config, sender, err_fn)?
            }
            sample_format => {
                return Err(format!("Unsupported system audio sample format: {sample_format:?}").into());
            }
        };

        stream.play()?;

        Ok((PlatformRunningSystemAudio::Cpal(stream), receiver))
    }

    fn system_audio_device(host: &cpal::Host) -> Result<cpal::Device, Box<dyn std::error::Error>> {
        host.default_output_device()
            .ok_or_else(|| "Windows did not return a default output device for WASAPI loopback.".into())
    }

    fn system_audio_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, Box<dyn std::error::Error>> {
        if let Ok(config) = device.default_input_config() {
            return Ok(config);
        }

        if let Ok(config) = device.default_output_config() {
            return Ok(config);
        }

        let mut configs = device.supported_input_configs()?;
        let preferred_rate = 48_000;

        configs
            .find_map(|range| {
                range
                    .clone()
                    .try_with_sample_rate(preferred_rate)
                    .or_else(|| Some(range.with_max_sample_rate()))
            })
            .ok_or_else(|| "Windows output device did not expose a WASAPI loopback input config.".into())
    }

    fn build_system_input_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        sender: mpsc::Sender<SystemAudioUpdate>,
        err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: Copy + cpal::SizedSample + ToFloatSample,
    {
        let sample_rate_hz = config.sample_rate;
        let channels = config.channels;

        device.build_input_stream(
            config,
            move |data: &[T], _| {
                let samples = data
                    .iter()
                    .map(|sample| ToFloatSample::to_float_sample(*sample))
                    .collect::<Vec<_>>();

                if let Some(level) = level_for_samples(&samples) {
                    let _ = sender.send(SystemAudioUpdate::Level(level));
                }

                let pcm16_base64 = encode_pcm16_base64(&samples);
                let _ = sender.send(SystemAudioUpdate::AudioFrame {
                    sample_rate_hz,
                    channels,
                    pcm16_base64,
                });
            },
            err_fn,
            None,
        )
    }
    fn system_audio_started_message() -> String {
        "WASAPI loopback capture started".to_string()
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{
        encode_pcm16_base64, level_for_samples, PlatformRunningSystemAudio, SystemAudioUpdate,
        ToFloatSample,
    };
    use std::io::{BufRead, BufReader, Read};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::mpsc::{self, Receiver};
    use std::thread;

    const SAMPLE_RATE_HZ: u32 = 48_000;
    const CHANNELS: u16 = 2;

    pub fn start(
        _repository_root: &Path,
        _transcribe_parakeet: bool,
    ) -> Result<(PlatformRunningSystemAudio, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>>
    {
        let (sender, receiver) = mpsc::channel();
        let mut child = Command::new("pw-record")
            .args([
                "--target",
                "@DEFAULT_AUDIO_SINK@",
                "--format",
                "s16",
                "--rate",
                "48000",
                "--channels",
                "2",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to spawn PipeWire recorder: {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("PipeWire recorder stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("PipeWire recorder stderr was unavailable")?;

        let _ = sender.send(SystemAudioUpdate::Stage(
            "PipeWire sink capture started".to_string(),
        ));
        let _ = sender.send(SystemAudioUpdate::Started {
            sample_rate_hz: SAMPLE_RATE_HZ,
            channels: CHANNELS,
        });

        let stdout_sender = sender.clone();
        thread::spawn(move || read_pcm16_stdout(stdout, stdout_sender));

        let stderr_sender = sender.clone();
        thread::spawn(move || read_stderr(stderr, stderr_sender));

        Ok((PlatformRunningSystemAudio::PipeWire(child), receiver))
    }

    fn read_pcm16_stdout(mut stdout: impl Read, sender: mpsc::Sender<SystemAudioUpdate>) {
        let mut buffer = vec![0_u8; 4096];
        let mut carry = Vec::<u8>::new();

        loop {
            let read = match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) => {
                    let _ = sender.send(SystemAudioUpdate::Error(format!(
                        "PipeWire recorder stream failed: {error}"
                    )));
                    break;
                }
            };

            let mut bytes = Vec::with_capacity(carry.len() + read);
            bytes.extend_from_slice(&carry);
            bytes.extend_from_slice(&buffer[..read]);

            let complete_len = bytes.len() - (bytes.len() % 2);
            carry.clear();
            carry.extend_from_slice(&bytes[complete_len..]);

            let samples = bytes[..complete_len]
                .chunks_exact(2)
                .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]).to_float_sample())
                .collect::<Vec<_>>();

            if samples.is_empty() {
                continue;
            }

            if let Some(level) = level_for_samples(&samples) {
                let _ = sender.send(SystemAudioUpdate::Level(level));
            }

            let _ = sender.send(SystemAudioUpdate::AudioFrame {
                sample_rate_hz: SAMPLE_RATE_HZ,
                channels: CHANNELS,
                pcm16_base64: encode_pcm16_base64(&samples),
            });
        }

        let _ = sender.send(SystemAudioUpdate::Stopped);
    }

    fn read_stderr(stderr: impl Read, sender: mpsc::Sender<SystemAudioUpdate>) {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) if line.trim().is_empty() => {}
                Ok(line) => {
                    let _ = sender.send(SystemAudioUpdate::Stage(format!(
                        "PipeWire recorder: {line}"
                    )));
                }
                Err(error) => {
                    let _ = sender.send(SystemAudioUpdate::Error(format!(
                        "PipeWire recorder stderr failed: {error}"
                    )));
                    break;
                }
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod platform {
    use super::{PlatformRunningSystemAudio, SystemAudioUpdate};
    use std::path::Path;
    use std::sync::mpsc::{self, Receiver};

    pub fn start(
        _repository_root: &Path,
        _transcribe_parakeet: bool,
    ) -> Result<(PlatformRunningSystemAudio, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>>
    {
        let (sender, receiver) = mpsc::channel();

        let _ = sender.send(SystemAudioUpdate::Error(
            "System audio capture is not implemented on this platform.".to_string(),
        ));

        Ok((PlatformRunningSystemAudio::Unsupported, receiver))
    }
}
