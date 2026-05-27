use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioSource {
    Microphone,
    System,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SampleFormat {
    F32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioFrame {
    pub source: AudioSource,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub format: SampleFormat,
    pub samples: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioLevel {
    pub source: AudioSource,
    pub peak: f32,
    pub rms: f32,
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("audio frame has no samples")]
    EmptyFrame,
    #[error("audio level must be between 0.0 and 1.0")]
    InvalidLevel,
}

impl AudioLevel {
    pub fn new(source: AudioSource, peak: f32, rms: f32) -> Result<Self, AudioError> {
        if !(0.0..=1.0).contains(&peak) || !(0.0..=1.0).contains(&rms) {
            return Err(AudioError::InvalidLevel);
        }

        Ok(Self { source, peak, rms })
    }
}

impl AudioFrame {
    pub fn new(
        source: AudioSource,
        sample_rate_hz: u32,
        channels: u16,
        samples: Vec<f32>,
    ) -> Result<Self, AudioError> {
        if samples.is_empty() {
            return Err(AudioError::EmptyFrame);
        }

        Ok(Self {
            source,
            sample_rate_hz,
            channels,
            format: SampleFormat::F32,
            samples,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_frames() {
        let frame = AudioFrame::new(AudioSource::Microphone, 48_000, 1, Vec::new());

        assert!(matches!(frame, Err(AudioError::EmptyFrame)));
    }

    #[test]
    fn rejects_invalid_levels() {
        let level = AudioLevel::new(AudioSource::System, 1.2, 0.2);

        assert!(matches!(level, Err(AudioError::InvalidLevel)));
    }
}
