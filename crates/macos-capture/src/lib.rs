use serde::Deserialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};
use susura_audio_core::{AudioLevel, AudioSource};

#[derive(Debug, thiserror::Error)]
pub enum MacosCaptureError {
    #[error("system audio capture is currently macOS-only")]
    UnsupportedPlatform,
    #[error("failed to spawn macOS audio helper: {0}")]
    Spawn(std::io::Error),
    #[error("failed to read helper stream: {0}")]
    Stream(std::io::Error),
    #[error("helper event was invalid: {0}")]
    InvalidEvent(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum CaptureUpdate {
    Started {
        sample_rate_hz: u32,
        channels: u16,
    },
    Stopped,
    Stage(String),
    SystemLevel(AudioLevel),
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HelperCommand {
    pub command: PathBuf,
    pub args: Vec<String>,
}

impl HelperCommand {
    pub fn system_audio(repository_root: impl AsRef<Path>, transcribe_parakeet: bool) -> Self {
        let repository_root = repository_root.as_ref();
        let capture_args = if transcribe_parakeet {
            vec![
                "--stream-system-audio".to_string(),
                "--transcribe-parakeet".to_string(),
            ]
        } else {
            vec!["--stream-system-audio".to_string()]
        };

        if let Ok(helper_path) = std::env::var("SUSURA_AUDIO_HELPER_PATH") {
            let helper_path = PathBuf::from(helper_path);

            if fs::metadata(&helper_path).is_ok() {
                return Self {
                    command: helper_path,
                    args: capture_args,
                };
            }
        }

        let package_path = repository_root.join("native").join("macos-audio-helper");
        let binary_path = package_path
            .join(".build")
            .join("debug")
            .join("SusuraAudioHelper");

        if fs::metadata(&binary_path).is_ok() {
            return Self {
                command: binary_path,
                args: capture_args,
            };
        }

        let mut args = vec![
            "run".to_string(),
            "--package-path".to_string(),
            package_path.to_string_lossy().into_owned(),
            "SusuraAudioHelper".to_string(),
        ];
        args.extend(capture_args);

        Self {
            command: PathBuf::from("swift"),
            args,
        }
    }
}

pub struct RunningCapture {
    child: Child,
}

impl RunningCapture {
    pub fn start_system_audio(
        repository_root: impl AsRef<Path>,
        transcribe_parakeet: bool,
    ) -> Result<(Self, Receiver<CaptureUpdate>), MacosCaptureError> {
        if !cfg!(target_os = "macos") {
            return Err(MacosCaptureError::UnsupportedPlatform);
        }

        let helper = HelperCommand::system_audio(repository_root, transcribe_parakeet);
        let mut child = Command::new(&helper.command)
            .args(&helper.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(MacosCaptureError::Spawn)?;

        let stdout = child.stdout.take().ok_or_else(|| {
            MacosCaptureError::Stream(std::io::Error::new(
                std::io::ErrorKind::Other,
                "helper stdout was unavailable",
            ))
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            MacosCaptureError::Stream(std::io::Error::new(
                std::io::ErrorKind::Other,
                "helper stderr was unavailable",
            ))
        })?;

        let (sender, receiver) = mpsc::channel();

        let stdout_sender = sender.clone();
        thread::spawn(move || read_stdout(stdout, stdout_sender));

        let stderr_sender = sender.clone();
        thread::spawn(move || read_stderr(stderr, stderr_sender));

        Ok((Self { child }, receiver))
    }

    pub fn stop(&mut self) {
        terminate_child(&mut self.child);
    }
}

impl Drop for RunningCapture {
    fn drop(&mut self) {
        terminate_child(&mut self.child);
    }
}

#[derive(Debug, Deserialize, PartialEq)]
struct HelperEvent {
    #[serde(rename = "type")]
    event_type: String,
    message: Option<String>,
    ok: Option<bool>,
    sample_rate: Option<f64>,
    channels: Option<u16>,
    level: Option<f64>,
    pcm16: Option<String>,
    text: Option<String>,
}

fn read_stdout(stdout: impl std::io::Read, sender: Sender<CaptureUpdate>) {
    for line in BufReader::new(stdout).lines() {
        match line {
            Ok(line) if line.trim().is_empty() => {}
            Ok(line) => match parse_helper_update(&line) {
                Ok(Some(update)) => {
                    let _ = sender.send(update);
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = sender.send(CaptureUpdate::Error(error.to_string()));
                }
            },
            Err(error) => {
                let _ = sender.send(CaptureUpdate::Error(error.to_string()));
            }
        }
    }

    let _ = sender.send(CaptureUpdate::Stopped);
}

fn read_stderr(stderr: impl std::io::Read, sender: Sender<CaptureUpdate>) {
    for line in BufReader::new(stderr).lines() {
        match line {
            Ok(line) if line.trim().is_empty() || is_ignorable_helper_stderr(&line) => {}
            Ok(line) => {
                let _ = sender.send(CaptureUpdate::Error(line));
            }
            Err(error) => {
                let _ = sender.send(CaptureUpdate::Error(error.to_string()));
            }
        }
    }
}

fn parse_helper_update(line: &str) -> Result<Option<CaptureUpdate>, MacosCaptureError> {
    let event: HelperEvent = serde_json::from_str(line)
        .map_err(|error| MacosCaptureError::InvalidEvent(error.to_string()))?;

    Ok(match event.event_type.as_str() {
        "capture_started" => Some(CaptureUpdate::Started {
            sample_rate_hz: event.sample_rate.unwrap_or(48_000.0).round() as u32,
            channels: event.channels.unwrap_or(1),
        }),
        "capture_stopped" => Some(CaptureUpdate::Stopped),
        "capture_stage" => event.message.map(CaptureUpdate::Stage),
        "system_level" => {
            let rms = (event.level.unwrap_or(0.0) / 100.0).clamp(0.0, 1.0) as f32;
            Some(CaptureUpdate::SystemLevel(
                AudioLevel::new(AudioSource::System, rms, rms)
                    .map_err(|error| MacosCaptureError::InvalidEvent(error.to_string()))?,
            ))
        }
        "audio_frame" => event.pcm16.map(|pcm16_base64| CaptureUpdate::AudioFrame {
            sample_rate_hz: event.sample_rate.unwrap_or(48_000.0).round() as u32,
            channels: event.channels.unwrap_or(1),
            pcm16_base64,
        }),
        "transcription_completed" => event.text.map(CaptureUpdate::TranscriptionCompleted),
        "transcription_partial" => event.text.map(CaptureUpdate::TranscriptionPartial),
        "speech_started" => Some(CaptureUpdate::SpeechStarted),
        "speech_stopped" => Some(CaptureUpdate::SpeechStopped),
        "permission_error" | "capture_error" => {
            Some(CaptureUpdate::Error(event.message.unwrap_or_else(|| {
                "System audio capture failed.".to_string()
            })))
        }
        _ => None,
    })
}

fn is_ignorable_helper_stderr(message: &str) -> bool {
    message
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .all(|line| {
            (line.contains("[FluidAudio.") && (line.contains("[INFO]") || line.contains("[DEBUG]")))
                || line.contains("manifest.plist")
        })
}

fn terminate_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }

    request_terminate(child);
    let deadline = Instant::now() + Duration::from_secs(2);

    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }

        thread::sleep(Duration::from_millis(50));
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
fn request_terminate(child: &Child) {
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
}

#[cfg(not(unix))]
fn request_terminate(child: &mut Child) {
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn parses_system_level_as_audio_level() {
        let update = parse_helper_update(r#"{"type":"system_level","level":37.5}"#)
            .expect("event should parse")
            .expect("event should map");

        assert_eq!(
            update,
            CaptureUpdate::SystemLevel(AudioLevel::new(AudioSource::System, 0.375, 0.375).unwrap())
        );
    }

    #[test]
    fn parses_started_event_defaults() {
        let update = parse_helper_update(r#"{"type":"capture_started","ok":true}"#)
            .expect("event should parse")
            .expect("event should map");

        assert_eq!(
            update,
            CaptureUpdate::Started {
                sample_rate_hz: 48_000,
                channels: 1
            }
        );
    }

    #[test]
    fn ignores_unknown_events() {
        let update = parse_helper_update(r#"{"type":"debug_noise"}"#).expect("event should parse");

        assert_eq!(update, None);
    }

    #[test]
    fn builds_swift_fallback_command() {
        let _guard = ENV_LOCK.lock().expect("env lock should be available");
        std::env::remove_var("SUSURA_AUDIO_HELPER_PATH");

        let command = HelperCommand::system_audio("/tmp/susura-missing-root", false);

        assert_eq!(command.command, PathBuf::from("swift"));
        assert!(command.args.contains(&"--stream-system-audio".to_string()));
    }

    #[test]
    fn uses_configured_audio_helper_path() {
        let _guard = ENV_LOCK.lock().expect("env lock should be available");
        let helper_path = std::env::current_exe().expect("test executable path");
        std::env::set_var("SUSURA_AUDIO_HELPER_PATH", &helper_path);

        let command = HelperCommand::system_audio("/tmp/susura-missing-root", false);

        std::env::remove_var("SUSURA_AUDIO_HELPER_PATH");
        assert_eq!(command.command, helper_path);
        assert_eq!(command.args, vec!["--stream-system-audio".to_string()]);
    }
}
