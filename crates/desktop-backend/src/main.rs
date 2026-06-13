use std::env;
use std::io::{self, Write};
use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use serde_json::json;

mod local_transcription;
mod system_audio;

use system_audio::{RunningSystemAudio, SystemAudioUpdate};

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

    if args
        .iter()
        .any(|arg| arg == "--fixture-long-transcription-soak")
    {
        local_transcription::run_long_transcription_soak_fixture()?;
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

    if args.iter().any(|arg| arg == "--windows-audio-diagnostics") {
        emit_json(system_audio::windows_audio_diagnostics());
        return Ok(());
    }

    if let Some(index) = args.iter().position(|arg| arg == "--protect-window-hwnd") {
        let hwnd = args
            .get(index + 1)
            .ok_or("--protect-window-hwnd requires a native window handle")?;
        emit_json(system_audio::protect_window_handle(hwnd)?);
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--stream-system-audio") {
        stream_system_audio(
            args.iter().any(|arg| arg == "--transcribe-parakeet"),
            StreamSystemAudioOptions {
                duration_limit: parse_duration_limit(&args),
                smoke_summary: args.iter().any(|arg| arg == "--smoke-summary"),
                windows_wasapi_smoke_tone: args
                    .iter()
                    .any(|arg| arg == "--windows-wasapi-smoke-tone"),
            },
        )?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--stream-microphone") {
        stream_microphone(StreamMicrophoneOptions {
            duration_limit: parse_duration_limit(&args).unwrap_or(Duration::from_secs(3)),
            smoke_summary: args.iter().any(|arg| arg == "--smoke-summary"),
        })?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--capture-restart-smoke") {
        run_capture_restart_smoke(CaptureRestartSmokeOptions {
            duration_limit: parse_duration_limit(&args).unwrap_or(Duration::from_secs(2)),
            source: parse_capture_restart_source(&args),
            windows_wasapi_smoke_tone: args.iter().any(|arg| arg == "--windows-wasapi-smoke-tone"),
        })?;
        return Ok(());
    }

    Err("unknown backend command".into())
}

fn parse_duration_limit(args: &[String]) -> Option<Duration> {
    let mut index = 0;

    while index < args.len() {
        if args[index] == "--duration-ms" {
            return args
                .get(index + 1)
                .and_then(|value| value.parse::<u64>().ok())
                .map(Duration::from_millis);
        }

        if args[index] == "--duration" {
            return args
                .get(index + 1)
                .and_then(|value| value.parse::<u64>().ok())
                .map(Duration::from_secs);
        }

        index += 1;
    }

    None
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

fn parse_capture_restart_source(args: &[String]) -> CaptureRestartSource {
    let mut index = 0;

    while index < args.len() {
        if args[index] == "--source" {
            return match args.get(index + 1).map(String::as_str) {
                Some("microphone") => CaptureRestartSource::Microphone,
                _ => CaptureRestartSource::System,
            };
        }

        index += 1;
    }

    CaptureRestartSource::System
}

struct StreamSystemAudioOptions {
    duration_limit: Option<Duration>,
    smoke_summary: bool,
    windows_wasapi_smoke_tone: bool,
}

struct StreamMicrophoneOptions {
    duration_limit: Duration,
    smoke_summary: bool,
}

struct CaptureRestartSmokeOptions {
    duration_limit: Duration,
    source: CaptureRestartSource,
    windows_wasapi_smoke_tone: bool,
}

#[derive(Clone, Copy)]
enum CaptureRestartSource {
    Microphone,
    System,
}

impl CaptureRestartSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::System => "system",
        }
    }
}

#[derive(Default)]
struct SystemAudioSmokeSummary {
    audio_frames: u64,
    capture_started: bool,
    detected: bool,
    level_events: u64,
    max_level: f64,
}

fn stream_system_audio(
    transcribe_parakeet: bool,
    options: StreamSystemAudioOptions,
) -> Result<(), Box<dyn std::error::Error>> {
    let started_at = Instant::now();
    let smoke_summary = collect_system_audio_smoke_summary(
        transcribe_parakeet,
        options.duration_limit,
        !options.smoke_summary,
        true,
        options.windows_wasapi_smoke_tone,
    )?;

    if options.smoke_summary {
        emit_json(json!({
            "type": "system_audio_smoke",
            "audio_frames": smoke_summary.audio_frames,
            "capture_started": smoke_summary.capture_started,
            "detected": smoke_summary.detected,
            "elapsed_ms": started_at.elapsed().as_millis(),
            "level_events": smoke_summary.level_events,
            "max_level": smoke_summary.max_level
        }));
    }

    Ok(())
}

fn collect_system_audio_smoke_summary(
    transcribe_parakeet: bool,
    duration_limit: Option<Duration>,
    emit_updates: bool,
    install_signal_handler: bool,
    windows_wasapi_smoke_tone: bool,
) -> Result<SystemAudioSmokeSummary, Box<dyn std::error::Error>> {
    let running = Arc::new(AtomicBool::new(true));

    if install_signal_handler {
        let signal_running = running.clone();

        ctrlc::set_handler(move || {
            signal_running.store(false, Ordering::SeqCst);
        })?;
    }

    let repository_root = env::current_dir()?;
    let (mut capture, receiver) = RunningSystemAudio::start(repository_root, transcribe_parakeet)?;
    #[cfg(target_os = "windows")]
    let tone_thread = if windows_wasapi_smoke_tone {
        Some(system_audio::spawn_wasapi_smoke_tone(
            duration_limit.unwrap_or(Duration::from_secs(3)),
        ))
    } else {
        None
    };
    #[cfg(not(target_os = "windows"))]
    let _ = windows_wasapi_smoke_tone;
    let started_at = Instant::now();
    let mut smoke_summary = SystemAudioSmokeSummary::default();

    while running.load(Ordering::SeqCst) {
        if duration_limit.is_some_and(|limit| started_at.elapsed() >= limit) {
            break;
        }

        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(update) => {
                apply_smoke_summary_update(&mut smoke_summary, &update);
                if emit_updates {
                    emit_capture_update(update);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    capture.stop();
    #[cfg(target_os = "windows")]
    if let Some(tone_thread) = tone_thread {
        let _ = tone_thread.join();
    }

    Ok(smoke_summary)
}

fn stream_microphone(options: StreamMicrophoneOptions) -> Result<(), Box<dyn std::error::Error>> {
    let summary = local_transcription::run_microphone_smoke(options.duration_limit)?;

    if options.smoke_summary {
        emit_json(json!({
            "type": "microphone_smoke",
            "audio_frames": summary.audio_frames,
            "capture_started": summary.capture_started,
            "detected": summary.detected,
            "elapsed_ms": summary.elapsed_ms,
            "level_events": summary.level_events,
            "max_level": summary.max_level
        }));
    }

    Ok(())
}

fn run_capture_restart_smoke(
    options: CaptureRestartSmokeOptions,
) -> Result<(), Box<dyn std::error::Error>> {
    let first = run_capture_restart_cycle(
        options.source,
        options.duration_limit,
        options.windows_wasapi_smoke_tone,
    )?;
    wait_between_restart_cycles();
    let second = run_capture_restart_cycle(
        options.source,
        options.duration_limit,
        options.windows_wasapi_smoke_tone,
    )?;

    let ok = first.ok() && second.ok();

    emit_json(json!({
        "type": "capture_restart_smoke",
        "ok": ok,
        "source": options.source.as_str(),
        "cycles": [first, second]
    }));

    if ok {
        Ok(())
    } else {
        Err(format!(
            "{} capture did not restart cleanly",
            options.source.as_str()
        )
        .into())
    }
}

fn run_capture_restart_cycle(
    source: CaptureRestartSource,
    duration_limit: Duration,
    windows_wasapi_smoke_tone: bool,
) -> Result<CaptureRestartCycleSummary, Box<dyn std::error::Error>> {
    match source {
        CaptureRestartSource::Microphone => {
            let summary = local_transcription::run_microphone_smoke(duration_limit)?;

            Ok(CaptureRestartCycleSummary {
                audio_frames: summary.audio_frames,
                capture_started: summary.capture_started,
                elapsed_ms: summary.elapsed_ms,
                level_events: summary.level_events,
                max_level: summary.max_level,
            })
        }
        CaptureRestartSource::System => {
            let summary = collect_system_audio_smoke_summary(
                false,
                Some(duration_limit),
                false,
                false,
                windows_wasapi_smoke_tone,
            )?;

            Ok(CaptureRestartCycleSummary {
                audio_frames: summary.audio_frames,
                capture_started: summary.capture_started,
                elapsed_ms: duration_limit.as_millis(),
                level_events: summary.level_events,
                max_level: summary.max_level,
            })
        }
    }
}

#[derive(serde::Serialize)]
struct CaptureRestartCycleSummary {
    audio_frames: u64,
    capture_started: bool,
    elapsed_ms: u128,
    level_events: u64,
    max_level: f64,
}

impl CaptureRestartCycleSummary {
    fn ok(&self) -> bool {
        self.capture_started
            && self.audio_frames > 0
            && self.level_events > 0
            && self.max_level > 0.0
    }
}

fn wait_between_restart_cycles() {
    std::thread::sleep(Duration::from_millis(300));
}

fn apply_smoke_summary_update(summary: &mut SystemAudioSmokeSummary, update: &SystemAudioUpdate) {
    match update {
        SystemAudioUpdate::Started { .. } => {
            summary.capture_started = true;
        }
        SystemAudioUpdate::Level(level) => {
            summary.level_events += 1;
            let rms = f64::from(level.rms);
            summary.max_level = summary.max_level.max(rms);
            summary.detected = summary.detected || rms > 0.001;
        }
        SystemAudioUpdate::AudioFrame { .. } => {
            summary.audio_frames += 1;
        }
        _ => {}
    }
}

fn emit_capture_update(update: SystemAudioUpdate) {
    match update {
        SystemAudioUpdate::Started {
            sample_rate_hz,
            channels,
        } => emit_json(json!({
            "type": "capture_started",
            "ok": true,
            "sample_rate": sample_rate_hz,
            "channels": channels
        })),
        SystemAudioUpdate::Stopped => emit_json(json!({
            "type": "capture_stopped"
        })),
        SystemAudioUpdate::Stage(message) => emit_json(json!({
            "type": "capture_stage",
            "message": message
        })),
        SystemAudioUpdate::Level(level) => {
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
        SystemAudioUpdate::AudioFrame {
            sample_rate_hz,
            channels,
            pcm16_base64,
        } => emit_json(json!({
            "type": "audio_frame",
            "sample_rate": sample_rate_hz,
            "channels": channels,
            "pcm16": pcm16_base64
        })),
        SystemAudioUpdate::TranscriptionCompleted(text) => emit_json(json!({
            "type": "transcription_completed",
            "text": text
        })),
        SystemAudioUpdate::TranscriptionPartial(text) => emit_json(json!({
            "type": "transcription_partial",
            "text": text
        })),
        SystemAudioUpdate::SpeechStarted => emit_json(json!({
            "type": "speech_started"
        })),
        SystemAudioUpdate::SpeechStopped => emit_json(json!({
            "type": "speech_stopped"
        })),
        SystemAudioUpdate::Error(message) => emit_json(json!({
            "type": "capture_error",
            "message": message
        })),
    }
}

fn emit_json(event: serde_json::Value) {
    println!("{event}");
    let _ = io::stdout().flush();
}
