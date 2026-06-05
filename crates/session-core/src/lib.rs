use serde::{Deserialize, Serialize};
use caul_audio_core::AudioLevel;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    Idle,
    Starting,
    Listening,
    Paused,
    Stopping,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum SessionEvent {
    CaptureStarted,
    CaptureStopped,
    Level(AudioLevel),
    PermissionError {
        permission: PermissionKind,
        message: String,
    },
    CaptureError {
        message: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionKind {
    Microphone,
    ScreenAndSystemAudio,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionStatus {
    pub state: SessionState,
    pub platform: String,
    pub capture_target: String,
}

impl SessionStatus {
    pub fn macos_ready() -> Self {
        Self {
            state: SessionState::Idle,
            platform: "macOS".to_string(),
            capture_target: "ScreenCaptureKit microphone plus system audio".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_status_names_capture_target() {
        let status = SessionStatus::macos_ready();

        assert_eq!(status.state, SessionState::Idle);
        assert!(status.capture_target.contains("ScreenCaptureKit"));
    }
}
