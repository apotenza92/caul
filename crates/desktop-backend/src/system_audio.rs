use std::path::Path;
use std::sync::mpsc::Receiver;

use base64::Engine;
use caul_audio_core::{AudioLevel, AudioSource};

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
    Macos(caul_macos_capture::RunningCapture),
    #[cfg(target_os = "windows")]
    Wasapi {
        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    },
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
            Self::Wasapi { stop, thread } => {
                stop.store(true, std::sync::atomic::Ordering::SeqCst);
                if let Some(thread) = thread.take() {
                    let _ = thread.join();
                }
            }
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

    let peak = samples
        .iter()
        .fold(0.0_f32, |max, sample| max.max(sample.abs()));
    let sum_squares = samples.iter().map(|sample| sample * sample).sum::<f32>();
    let rms = (sum_squares / samples.len() as f32).sqrt();

    AudioLevel::new(
        AudioSource::System,
        peak.clamp(0.0, 1.0),
        rms.clamp(0.0, 1.0),
    )
    .ok()
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

#[cfg(target_os = "windows")]
pub fn windows_audio_diagnostics() -> serde_json::Value {
    platform::windows_audio_diagnostics()
}

#[cfg(not(target_os = "windows"))]
pub fn windows_audio_diagnostics() -> serde_json::Value {
    serde_json::json!({
        "error": "Windows audio diagnostics are only available on Windows.",
        "ok": false,
        "platform": std::env::consts::OS,
        "type": "windows_audio_diagnostics"
    })
}

#[cfg(target_os = "windows")]
pub fn protect_window_handle(value: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    platform::protect_window_handle(value)
}

#[cfg(not(target_os = "windows"))]
pub fn protect_window_handle(value: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    Ok(serde_json::json!({
        "hwnd": value,
        "ok": false,
        "platform": std::env::consts::OS,
        "type": "window_display_affinity",
        "error": "Window display affinity is only available on Windows."
    }))
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
        let (capture, receiver) = caul_macos_capture::RunningCapture::start_system_audio(
            repository_root,
            transcribe_parakeet,
        )?;
        let (sender, mapped_receiver) = mpsc::channel();

        thread::spawn(move || {
            for update in receiver {
                let mapped = match update {
                    caul_macos_capture::CaptureUpdate::Started {
                        sample_rate_hz,
                        channels,
                    } => SystemAudioUpdate::Started {
                        sample_rate_hz,
                        channels,
                    },
                    caul_macos_capture::CaptureUpdate::Stopped => SystemAudioUpdate::Stopped,
                    caul_macos_capture::CaptureUpdate::Stage(message) => {
                        SystemAudioUpdate::Stage(message)
                    }
                    caul_macos_capture::CaptureUpdate::SystemLevel(level) => {
                        SystemAudioUpdate::Level(level)
                    }
                    caul_macos_capture::CaptureUpdate::AudioFrame {
                        sample_rate_hz,
                        channels,
                        pcm16_base64,
                    } => SystemAudioUpdate::AudioFrame {
                        sample_rate_hz,
                        channels,
                        pcm16_base64,
                    },
                    caul_macos_capture::CaptureUpdate::TranscriptionCompleted(text) => {
                        SystemAudioUpdate::TranscriptionCompleted(text)
                    }
                    caul_macos_capture::CaptureUpdate::TranscriptionPartial(text) => {
                        SystemAudioUpdate::TranscriptionPartial(text)
                    }
                    caul_macos_capture::CaptureUpdate::SpeechStarted => {
                        SystemAudioUpdate::SpeechStarted
                    }
                    caul_macos_capture::CaptureUpdate::SpeechStopped => {
                        SystemAudioUpdate::SpeechStopped
                    }
                    caul_macos_capture::CaptureUpdate::Error(message) => {
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
    };
    use std::collections::VecDeque;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Receiver};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    use wasapi::{
        initialize_mta, AudioClient, Device, DeviceEnumerator, Direction, SampleType, StreamMode,
    };

    pub fn start(
        _repository_root: &Path,
        _transcribe_parakeet: bool,
    ) -> Result<(PlatformRunningSystemAudio, Receiver<SystemAudioUpdate>), Box<dyn std::error::Error>>
    {
        let (sender, receiver) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);

        let thread = thread::spawn(move || run_wasapi_loopback(sender, thread_stop));

        Ok((
            PlatformRunningSystemAudio::Wasapi {
                stop,
                thread: Some(thread),
            },
            receiver,
        ))
    }

    fn run_wasapi_loopback(sender: mpsc::Sender<SystemAudioUpdate>, stop: Arc<AtomicBool>) {
        if let Err(error) = run_wasapi_loopback_inner(&sender, stop) {
            let _ = sender.send(SystemAudioUpdate::Error(format!(
                "WASAPI loopback capture failed: {error}"
            )));
        }

        let _ = sender.send(SystemAudioUpdate::Stopped);
    }

    fn run_wasapi_loopback_inner(
        sender: &mpsc::Sender<SystemAudioUpdate>,
        stop: Arc<AtomicBool>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        initialize_mta().ok()?;

        let enumerator = DeviceEnumerator::new()?;
        let device = select_render_device(&enumerator)?;
        let mut audio_client: AudioClient = device.get_iaudioclient()?;
        let desired_format = audio_client.get_mixformat()?;
        let sample_rate_hz = desired_format.get_samplespersec();
        let channels = desired_format.get_nchannels();
        let sample_type = desired_format.get_subformat()?;
        let bits_per_sample = desired_format.get_bitspersample();
        let block_align = desired_format.get_blockalign() as usize;
        let (_default_period, min_period) = audio_client.get_device_period()?;
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: min_period,
        };

        audio_client.initialize_client(&desired_format, &Direction::Capture, &mode)?;
        let capture_client = audio_client.get_audiocaptureclient()?;
        let mut sample_queue = VecDeque::<u8>::with_capacity(block_align * 4096);

        let _ = sender.send(SystemAudioUpdate::Stage(
            "WASAPI polling loopback capture started".to_string(),
        ));
        let _ = sender.send(SystemAudioUpdate::Started {
            sample_rate_hz,
            channels,
        });

        audio_client.start_stream()?;

        while !stop.load(Ordering::SeqCst) {
            capture_client.read_from_device_to_deque(&mut sample_queue)?;

            while sample_queue.len() >= block_align * 256 {
                let mut bytes = Vec::with_capacity(block_align * 256);

                for _ in 0..(block_align * 256) {
                    if let Some(byte) = sample_queue.pop_front() {
                        bytes.push(byte);
                    }
                }

                let samples = decode_wasapi_samples(&bytes, sample_type, bits_per_sample);

                if let Some(level) = level_for_samples(&samples) {
                    let _ = sender.send(SystemAudioUpdate::Level(level));
                }

                let _ = sender.send(SystemAudioUpdate::AudioFrame {
                    sample_rate_hz,
                    channels,
                    pcm16_base64: encode_pcm16_base64(&samples),
                });
            }

            thread::sleep(Duration::from_millis(10));
        }

        audio_client.stop_stream()?;

        Ok(())
    }

    fn decode_wasapi_samples(
        bytes: &[u8],
        sample_type: SampleType,
        bits_per_sample: u16,
    ) -> Vec<f32> {
        match (sample_type, bits_per_sample) {
            (SampleType::Float, 32) => bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect(),
            (SampleType::Int, 16) => bytes
                .chunks_exact(2)
                .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
                .collect(),
            (SampleType::Int, 24) => bytes
                .chunks_exact(3)
                .map(|chunk| {
                    let value = i32::from_le_bytes([
                        chunk[0],
                        chunk[1],
                        chunk[2],
                        if chunk[2] & 0x80 == 0 { 0x00 } else { 0xff },
                    ]);
                    value as f32 / 8_388_607.0
                })
                .collect(),
            (SampleType::Int, 32) => bytes
                .chunks_exact(4)
                .map(|chunk| {
                    i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f32
                        / i32::MAX as f32
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    pub(super) fn select_render_device(enumerator: &DeviceEnumerator) -> Result<Device, Box<dyn std::error::Error>> {
        match enumerator.get_default_device(&Direction::Render) {
            Ok(device) => Ok(device),
            Err(default_error) => {
                let collection = enumerator.get_device_collection(&Direction::Render)?;

                if collection.get_nbr_devices()? == 0 {
                    return Err(format!(
                        "No active WASAPI render endpoints are available after default endpoint failed: {default_error}"
                    )
                    .into());
                }

                Ok(collection.get_device_at_index(0)?)
            }
        }
    }

    pub fn windows_audio_diagnostics() -> serde_json::Value {
        match collect_windows_audio_diagnostics() {
            Ok(value) => value,
            Err(error) => serde_json::json!({
                "error": error.to_string(),
                "ok": false,
                "platform": "windows",
                "type": "windows_audio_diagnostics"
            }),
        }
    }

    fn collect_windows_audio_diagnostics() -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        initialize_mta().ok()?;

        let enumerator = DeviceEnumerator::new()?;
        let default_device = enumerator.get_default_device(&Direction::Render);
        let default_render_error = default_device.as_ref().err().map(|error| error.to_string());
        let device = match default_device {
            Ok(device) => device,
            Err(_) => select_render_device(&enumerator)?,
        };
        let selected_device_name = device.get_friendlyname().unwrap_or_else(|_| "unknown".to_string());
        let mut audio_client: AudioClient = device.get_iaudioclient()?;
        let desired_format = audio_client.get_mixformat()?;
        let periods = audio_client.get_device_period();
        let sample_rate_hz = desired_format.get_samplespersec();
        let channels = desired_format.get_nchannels();
        let sample_type = format!("{:?}", desired_format.get_subformat()?);
        let bits_per_sample = desired_format.get_bitspersample();
        let block_align = desired_format.get_blockalign();
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: periods
                .as_ref()
                .map(|(_, min_period)| *min_period)
                .unwrap_or(0),
        };
        let loopback_initialise = audio_client.initialize_client(&desired_format, &Direction::Capture, &mode);
        let loopback_initialise_ok = loopback_initialise.is_ok();

        Ok(serde_json::json!({
            "defaultRenderDevice": true,
            "defaultRenderError": default_render_error,
            "devicePeriod": match periods {
                Ok((default_period, minimum_period)) => serde_json::json!({
                    "defaultHns": default_period,
                    "minimumHns": minimum_period
                }),
                Err(error) => serde_json::json!({
                    "error": error.to_string()
                })
            },
            "selectedRenderDevice": selected_device_name,
            "loopbackInitialise": match loopback_initialise {
                Ok(_) => serde_json::json!({ "ok": true }),
                Err(error) => serde_json::json!({
                    "error": error.to_string(),
                    "ok": false
                })
            },
            "mixFormat": {
                "bitsPerSample": bits_per_sample,
                "blockAlign": block_align,
                "channels": channels,
                "sampleRateHz": sample_rate_hz,
                "sampleType": sample_type
            },
            "ok": loopback_initialise_ok,
            "platform": "windows",
            "type": "windows_audio_diagnostics"
        }))
    }

    pub fn protect_window_handle(value: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
        };

        let hwnd_value = parse_hwnd(value)?;
        let hwnd = hwnd_value as HWND;

        if hwnd.is_null() {
            return Err("native window handle was null".into());
        }

        let set_ok = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) } != 0;
        let mut affinity = 0_u32;
        let read_ok = unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) } != 0;

        Ok(serde_json::json!({
            "affinity": affinity,
            "hwnd": hwnd_value,
            "ok": set_ok && read_ok && affinity == WDA_EXCLUDEFROMCAPTURE,
            "platform": "windows",
            "readOk": read_ok,
            "setOk": set_ok,
            "type": "window_display_affinity"
        }))
    }

    fn parse_hwnd(value: &str) -> Result<isize, Box<dyn std::error::Error>> {
        let trimmed = value.trim();

        if let Some(hex) = trimmed.strip_prefix("0x") {
            return Ok(isize::from_str_radix(hex, 16)?);
        }

        Ok(trimmed.parse::<isize>()?)
    }
}

#[cfg(target_os = "windows")]
pub fn spawn_wasapi_smoke_tone(duration: std::time::Duration) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        if let Err(error) = play_wasapi_smoke_tone(duration) {
            eprintln!("Windows WASAPI smoke tone failed: {error}");
        }
    })
}

#[cfg(target_os = "windows")]
fn play_wasapi_smoke_tone(duration: std::time::Duration) -> Result<(), Box<dyn std::error::Error>> {
    use std::collections::VecDeque;
    use std::f32::consts::PI;
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, StreamMode};

    initialize_mta().ok()?;

    let enumerator = DeviceEnumerator::new()?;
    let device = platform::select_render_device(&enumerator)?;
    let mut audio_client = device.get_iaudioclient()?;
    let desired_format = audio_client.get_mixformat()?;
    let block_align = desired_format.get_blockalign() as usize;
    let sample_rate_hz = desired_format.get_samplespersec();
    let channels = desired_format.get_nchannels();
    let sample_type = desired_format.get_subformat()?;
    let bits_per_sample = desired_format.get_bitspersample();
    let mode = StreamMode::PollingShared {
        autoconvert: false,
        buffer_duration_hns: 0,
    };

    audio_client.initialize_client(&desired_format, &Direction::Render, &mode)?;
    let render_client = audio_client.get_audiorenderclient()?;
    let total_frames = duration
        .as_secs()
        .saturating_mul(sample_rate_hz as u64)
        .saturating_add(duration.subsec_nanos() as u64 * sample_rate_hz as u64 / 1_000_000_000);
    let mut rendered_frames = 0_u64;
    let mut sample_queue = VecDeque::<u8>::with_capacity(block_align * 4096);

    audio_client.start_stream()?;

    while rendered_frames < total_frames {
        let available_frames = audio_client.get_available_space_in_frames()?.max(1) as u64;
        let frames_to_write = available_frames.min(total_frames - rendered_frames) as usize;
        let frames_to_write = frames_to_write.min(256);

        for frame_offset in 0..frames_to_write {
            let frame_index = rendered_frames + frame_offset as u64;
            let elapsed = frame_index as f32 / sample_rate_hz as f32;
            let envelope = if elapsed < 0.08 { elapsed / 0.08 } else { 1.0 };
            let sample = ((2.0 * PI * 440.0 * elapsed).sin()
                + (2.0 * PI * 659.25 * elapsed).sin() * 0.65)
                * 0.18
                * envelope.min(1.0);

            for _ in 0..channels {
                append_wasapi_tone_sample(&mut sample_queue, sample, sample_type, bits_per_sample)?;
            }
        }

        render_client.write_to_device_from_deque(frames_to_write, &mut sample_queue, None)?;
        rendered_frames += frames_to_write as u64;
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    audio_client.stop_stream()?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn append_wasapi_tone_sample(
    sample_queue: &mut std::collections::VecDeque<u8>,
    sample: f32,
    sample_type: wasapi::SampleType,
    bits_per_sample: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    match (sample_type, bits_per_sample) {
        (wasapi::SampleType::Float, 32) => {
            sample_queue.extend(sample.to_le_bytes());
            Ok(())
        }
        (wasapi::SampleType::Int, 16) => {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            sample_queue.extend(value.to_le_bytes());
            Ok(())
        }
        (wasapi::SampleType::Int, 24) => {
            let value = (sample.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
            let bytes = value.to_le_bytes();
            sample_queue.extend([bytes[0], bytes[1], bytes[2]]);
            Ok(())
        }
        (wasapi::SampleType::Int, 32) => {
            let value = (sample.clamp(-1.0, 1.0) * i32::MAX as f32).round() as i32;
            sample_queue.extend(value.to_le_bytes());
            Ok(())
        }
        _ => Err(format!(
            "unsupported WASAPI smoke tone format: {sample_type:?} {bits_per_sample}-bit"
        )
        .into()),
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
