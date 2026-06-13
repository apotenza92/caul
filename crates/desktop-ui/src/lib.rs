use caul_audio_core::{AudioLevel, AudioSource};
use caul_macos_capture::CaptureUpdate;
use caul_session_core::SessionState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureSettings {
    pub api_key: String,
    pub listen_to_microphone: bool,
    pub listen_to_system_audio: bool,
}

impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            listen_to_microphone: false,
            listen_to_system_audio: true,
        }
    }
}

impl CaptureSettings {
    pub fn has_selected_source(&self) -> bool {
        self.listen_to_microphone || self.listen_to_system_audio
    }

    pub fn provider_label(&self) -> &'static str {
        if self.api_key.trim().is_empty() {
            "Local transcription"
        } else {
            "Provider key entered"
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeUiModel {
    pub session_state: SessionState,
    pub settings: CaptureSettings,
    pub microphone_level: AudioLevel,
    pub system_level: AudioLevel,
    pub audio_frame_count: u64,
    pub transcript: String,
    status_message: String,
}

impl Default for NativeUiModel {
    fn default() -> Self {
        Self {
            session_state: SessionState::Idle,
            settings: CaptureSettings::default(),
            microphone_level: AudioLevel::new(AudioSource::Microphone, 0.0, 0.0)
                .expect("zero microphone level is valid"),
            system_level: AudioLevel::new(AudioSource::System, 0.0, 0.0)
                .expect("zero system level is valid"),
            audio_frame_count: 0,
            transcript: String::new(),
            status_message: "Native Rust UI is ready. Capture starts through the macOS helper."
                .to_string(),
        }
    }
}

impl NativeUiModel {
    pub fn can_start_system_audio(&self) -> bool {
        self.session_state == SessionState::Idle && self.settings.listen_to_system_audio
    }

    pub fn start_system_audio(&mut self) {
        if self.settings.listen_to_system_audio {
            self.session_state = SessionState::Starting;
            self.audio_frame_count = 0;
            self.transcript.clear();
            self.status_message = "Starting macOS system audio capture.".to_string();
        }
    }

    pub fn reset_session(&mut self) {
        self.session_state = SessionState::Idle;
        self.audio_frame_count = 0;
        self.system_level =
            AudioLevel::new(AudioSource::System, 0.0, 0.0).expect("zero system level is valid");

        self.status_message = "System audio capture is stopped.".to_string();
    }

    pub fn fail_session(&mut self, message: impl Into<String>) {
        self.session_state = SessionState::Failed;
        self.status_message = message.into();
    }

    pub fn apply_capture_update(&mut self, update: CaptureUpdate) {
        match update {
            CaptureUpdate::Started { .. } => {
                self.session_state = SessionState::Listening;
                self.status_message = "Core Audio capture started.".to_string();
            }
            CaptureUpdate::Stopped => {
                if self.session_state != SessionState::Idle {
                    self.reset_session();
                }
            }
            CaptureUpdate::Stage(message) => {
                if self.session_state == SessionState::Idle {
                    self.session_state = SessionState::Starting;
                }

                self.status_message = message;
            }
            CaptureUpdate::SystemLevel(level) => {
                self.system_level = level;
            }
            CaptureUpdate::AudioFrame { .. } => {
                self.audio_frame_count += 1;
            }
            CaptureUpdate::TranscriptionCompleted(text) => {
                let text = text.trim();

                if !text.is_empty() {
                    if !self.transcript.is_empty() {
                        self.transcript.push('\n');
                    }

                    self.transcript.push_str(text);
                    self.status_message = "Confirmed local transcript received.".to_string();
                }
            }
            CaptureUpdate::TranscriptionPartial(text) => {
                let text = text.trim();

                if !text.is_empty() {
                    self.status_message = "Transcribing local audio.".to_string();
                }
            }
            CaptureUpdate::SpeechStarted => {
                self.status_message = "Speech detected.".to_string();
            }
            CaptureUpdate::SpeechStopped => {
                self.status_message = "Speech stopped.".to_string();
            }
            CaptureUpdate::Error(message) => {
                self.fail_session(message);
            }
        }
    }

    pub fn session_label(&self) -> &'static str {
        match self.session_state {
            SessionState::Idle => "Ready",
            SessionState::Starting => "Starting",
            SessionState::Listening => "Listening",
            SessionState::Paused => "Prepared",
            SessionState::Stopping => "Stopping",
            SessionState::Failed => "Needs attention",
        }
    }

    pub fn status_message(&self) -> &str {
        &self.status_message
    }

    pub fn visible_transcript(&self) -> &str {
        &self.transcript
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_system_audio_selected() {
        let model = NativeUiModel::default();

        assert!(model.can_start_system_audio());
        assert!(model.settings.listen_to_system_audio);
        assert!(!model.settings.listen_to_microphone);
    }

    #[test]
    fn cannot_start_without_system_audio() {
        let mut model = NativeUiModel::default();
        model.settings.listen_to_system_audio = false;
        model.settings.listen_to_microphone = true;

        assert!(!model.can_start_system_audio());
    }

    #[test]
    fn starting_session_does_not_claim_capture_started() {
        let mut model = NativeUiModel::default();

        model.start_system_audio();

        assert_eq!(model.session_state, SessionState::Starting);
        assert!(model.status_message().contains("Starting"));
    }

    #[test]
    fn capture_started_event_marks_session_listening() {
        let mut model = NativeUiModel::default();

        model.apply_capture_update(CaptureUpdate::Started {
            sample_rate_hz: 24_000,
            channels: 1,
        });

        assert_eq!(model.session_state, SessionState::Listening);
        assert!(model.status_message().contains("started"));
    }

    #[test]
    fn completed_transcript_is_appended() {
        let mut model = NativeUiModel::default();

        model.apply_capture_update(CaptureUpdate::TranscriptionCompleted(
            "hello from system audio".to_string(),
        ));

        assert_eq!(model.transcript, "hello from system audio");
        assert!(model.status_message().contains("transcript"));
    }

    #[test]
    fn visible_transcript_keeps_confirmed_text_when_partial_arrives() {
        let mut model = NativeUiModel::default();
        model.apply_capture_update(CaptureUpdate::TranscriptionCompleted(
            "confirmed text".to_string(),
        ));
        model.apply_capture_update(CaptureUpdate::TranscriptionPartial(
            "diagnostic live text".to_string(),
        ));

        assert_eq!(model.visible_transcript(), "confirmed text");
    }

    #[test]
    fn stopping_does_not_commit_live_partial_to_transcript() {
        let mut model = NativeUiModel::default();
        model.apply_capture_update(CaptureUpdate::TranscriptionPartial(
            "diagnostic live text".to_string(),
        ));

        model.reset_session();

        assert_eq!(model.visible_transcript(), "");
    }
}
