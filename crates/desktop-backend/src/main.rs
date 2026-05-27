use std::env;
use std::io::{self, Write};
use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde_json::json;
use susura_macos_capture::{CaptureUpdate, RunningCapture};

mod local_transcription;

fn main() {
    if let Err(error) = run() {
        emit_json(json!({
            "type": "capture_error",
            "message": error.to_string()
        }));
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();

    if args.iter().any(|arg| arg == "--local-transcription") {
        let sources = parse_local_transcription_sources(&args);
        local_transcription::run(sources)?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--local-transcription-daemon") {
        local_transcription::run_daemon()?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--fixture-live-pipeline") {
        local_transcription::run_fixture_pipeline_smoke();
        return Ok(());
    }

    if let Some(index) = args
        .iter()
        .position(|arg| arg == "--transcribe-parakeet-wav")
    {
        let path = args
            .get(index + 1)
            .ok_or("--transcribe-parakeet-wav requires a WAV path")?;
        local_transcription::run_parakeet_wav_benchmark(Path::new(path))?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--stream-system-audio") {
        stream_system_audio(args.iter().any(|arg| arg == "--transcribe-parakeet"))?;
        return Ok(());
    }

    Err("unknown backend command".into())
}

fn parse_local_transcription_sources(
    args: &[String],
) -> Vec<local_transcription::TranscriptSource> {
    let mut sources = Vec::new();
    let mut index = 0;

    while index < args.len() {
        if args[index] == "--source" {
            if let Some(value) = args.get(index + 1) {
                if let Some(source) = local_transcription::TranscriptSource::parse(value) {
                    if !sources.contains(&source) {
                        sources.push(source);
                    }
                }
            }
            index += 2;
            continue;
        }

        index += 1;
    }

    sources
}

fn stream_system_audio(transcribe_parakeet: bool) -> Result<(), Box<dyn std::error::Error>> {
    let running = Arc::new(AtomicBool::new(true));
    let signal_running = running.clone();

    ctrlc::set_handler(move || {
        signal_running.store(false, Ordering::SeqCst);
    })?;

    let repository_root = env::current_dir()?;
    let (mut capture, receiver) =
        RunningCapture::start_system_audio(repository_root, transcribe_parakeet)?;

    while running.load(Ordering::SeqCst) {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(update) => emit_capture_update(update),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    capture.stop();
    Ok(())
}

fn emit_capture_update(update: CaptureUpdate) {
    match update {
        CaptureUpdate::Started {
            sample_rate_hz,
            channels,
        } => emit_json(json!({
            "type": "capture_started",
            "ok": true,
            "sample_rate": sample_rate_hz,
            "channels": channels
        })),
        CaptureUpdate::Stopped => emit_json(json!({
            "type": "capture_stopped"
        })),
        CaptureUpdate::Stage(message) => emit_json(json!({
            "type": "capture_stage",
            "message": message
        })),
        CaptureUpdate::SystemLevel(level) => {
            let percent = f64::from(level.rms * 100.0);
            let decibels = if level.rms <= 0.0 {
                -120.0
            } else {
                20.0 * f64::from(level.rms).log10()
            };

            emit_json(json!({
                "type": "system_level",
                "level": percent,
                "decibels": decibels
            }));
        }
        CaptureUpdate::AudioFrame {
            sample_rate_hz,
            channels,
            pcm16_base64,
        } => emit_json(json!({
            "type": "audio_frame",
            "sample_rate": sample_rate_hz,
            "channels": channels,
            "pcm16": pcm16_base64
        })),
        CaptureUpdate::TranscriptionCompleted(text) => emit_json(json!({
            "type": "transcription_completed",
            "text": text
        })),
        CaptureUpdate::TranscriptionPartial(text) => emit_json(json!({
            "type": "transcription_partial",
            "text": text
        })),
        CaptureUpdate::SpeechStarted => emit_json(json!({
            "type": "speech_started"
        })),
        CaptureUpdate::SpeechStopped => emit_json(json!({
            "type": "speech_stopped"
        })),
        CaptureUpdate::Error(message) => emit_json(json!({
            "type": "capture_error",
            "message": message
        })),
    }
}

fn emit_json(event: serde_json::Value) {
    println!("{event}");
    let _ = io::stdout().flush();
}
