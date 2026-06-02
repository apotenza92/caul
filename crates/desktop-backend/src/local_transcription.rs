use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedIn, Resampler};
use serde_json::{json, Value};
use transcribe_rs::onnx::moonshine::{MoonshineStreamingParams, StreamingModel};
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

use crate::system_audio::{RunningSystemAudio, SystemAudioUpdate};

const OUTPUT_SAMPLE_RATE_HZ: u32 = 16_000;
const VAD_FRAME_MS: u64 = 30;
const VAD_FRAME_SAMPLES: usize = (OUTPUT_SAMPLE_RATE_HZ as usize * VAD_FRAME_MS as usize) / 1000;
const RESAMPLER_CHUNK_SIZE: usize = 1024;
const PRE_ROLL_MS: u64 = 200;
const MIN_SPEECH_MS: u64 = 250;
const END_SILENCE_MS: u64 = 450;
const MAX_UTTERANCE_MS: u64 = 8_000;
const ENERGY_SPEECH_THRESHOLD: f32 = 0.004;
const LIVE_PARTIAL_MIN_MS: u64 = 200;
const LIVE_PARTIAL_INTERVAL_MS: u64 = 250;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TranscriptSource {
    Microphone,
    System,
}

#[derive(Debug, Default)]
pub struct MicrophoneSmokeSummary {
    pub audio_frames: u64,
    pub capture_started: bool,
    pub detected: bool,
    pub elapsed_ms: u128,
    pub level_events: u64,
    pub max_level: f64,
}

impl TranscriptSource {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "microphone" => Some(Self::Microphone),
            "system" => Some(Self::System),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::System => "system",
        }
    }
}

pub fn run_microphone_smoke(
    duration_limit: Duration,
) -> Result<MicrophoneSmokeSummary, Box<dyn std::error::Error>> {
    let (audio_tx, audio_rx) = mpsc::channel::<AudioFrame>();
    let (event_tx, event_rx) = mpsc::channel::<BackendEvent>();
    let _microphone_capture = MicrophoneCapture::start(audio_tx, event_tx)?;
    let started_at = Instant::now();
    let mut summary = MicrophoneSmokeSummary::default();

    while started_at.elapsed() < duration_limit {
        while let Ok(event) = event_rx.try_recv() {
            match event {
                BackendEvent::Stage(message) if message == "microphone capture started" => {
                    summary.capture_started = true;
                }
                BackendEvent::Error(message) => return Err(message.into()),
                _ => {}
            }
        }

        match audio_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => {
                summary.audio_frames += 1;
                summary.level_events += 1;
                let level = f64::from(frame_rms(&frame.samples));
                summary.max_level = summary.max_level.max(level);
                summary.detected = summary.detected || level > 0.001;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    summary.elapsed_ms = started_at.elapsed().as_millis();
    Ok(summary)
}

#[derive(Debug)]
struct AudioFrame {
    source: TranscriptSource,
    sample_rate_hz: u32,
    channels: u16,
    samples: Vec<f32>,
}

#[derive(Clone, Debug)]
struct SpeechSegment {
    source: TranscriptSource,
    id: u64,
    start_ms: u64,
    end_ms: u64,
    endpoint_reason: EndpointReason,
    metrics: PipelineTimings,
    samples: Vec<f32>,
}

#[derive(Clone, Debug)]
struct SpeechPreview {
    source: TranscriptSource,
    id: u64,
    start_ms: u64,
    end_ms: u64,
    queued_at_ms: u64,
    partial_gate: Arc<AtomicBool>,
    samples: Vec<f32>,
}

#[derive(Clone, Debug, Default)]
struct PartialStability {
    emitted_text: String,
    previous_raw_text: String,
}

#[derive(Debug)]
enum BackendEvent {
    Partial {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
        end_ms: u64,
        text: String,
    },
    Completed {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
        end_ms: u64,
        text: String,
    },
    Error(String),
    Metric {
        name: &'static str,
        utterance_id: Option<u64>,
        at_ms: u64,
    },
    Stage(String),
}

enum TranscriptionJob {
    Warmup,
    Partial(SpeechPreview),
    Segment(SpeechSegment),
    Barrier(Sender<()>),
    Stop,
}

enum DaemonCommand {
    Prepare { sources: Vec<TranscriptSource> },
    Start { sources: Vec<TranscriptSource> },
    Stop,
    Quit,
}

pub fn run(sources: Vec<TranscriptSource>) -> Result<(), Box<dyn std::error::Error>> {
    if sources.is_empty() {
        return Err("at least one local transcription source is required".into());
    }

    let running = Arc::new(AtomicBool::new(true));
    let signal_running = running.clone();
    ctrlc::set_handler(move || {
        signal_running.store(false, Ordering::SeqCst);
    })?;

    start_stdin_stop_thread(running.clone());

    let clock = PipelineClock::new();
    let (audio_tx, audio_rx) = mpsc::channel::<AudioFrame>();
    let (event_tx, event_rx) = mpsc::channel::<BackendEvent>();
    let (job_tx, job_rx) = mpsc::channel::<TranscriptionJob>();
    let transcription_events = event_tx.clone();
    let transcription_clock = clock.clone();
    let transcription_thread = thread::spawn(move || {
        run_transcription_worker(job_rx, transcription_events, transcription_clock);
    });

    let mut microphone_capture = None;
    let mut system_thread = None;

    if sources.contains(&TranscriptSource::Microphone) {
        event_tx.send(BackendEvent::Stage(
            "starting microphone capture".to_string(),
        ))?;
        microphone_capture = Some(MicrophoneCapture::start(
            audio_tx.clone(),
            event_tx.clone(),
        )?);
    }

    if sources.contains(&TranscriptSource::System) {
        event_tx.send(BackendEvent::Stage(
            "starting system audio capture".to_string(),
        ))?;
        let repository_root = std::env::current_dir()?;
        system_thread = Some(start_system_audio_thread(
            repository_root,
            audio_tx.clone(),
            event_tx.clone(),
            running.clone(),
        ));
    }

    let endpoint_config = EndpointConfig::from_environment();
    let partial_gate = Arc::new(AtomicBool::new(false));
    let mut batchers = sources
        .iter()
        .copied()
        .map(|source| {
            (
                source,
                SourcePipeline::with_partial_gate(
                    source,
                    clock.clone(),
                    endpoint_config,
                    partial_gate.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut saw_audio = false;
    let emit_pipeline_metrics = pipeline_metrics_enabled();

    event_tx.send(BackendEvent::Stage(
        "local Parakeet capture started".to_string(),
    ))?;

    if emit_pipeline_metrics {
        if let Some(expected_speech_end_at) = expected_speech_end_ms() {
            let _ = event_tx.send(BackendEvent::Metric {
                name: "expected_speech_end_at",
                utterance_id: None,
                at_ms: expected_speech_end_at,
            });
        }
    }

    while running.load(Ordering::SeqCst) {
        match audio_rx.recv_timeout(Duration::from_millis(25)) {
            Ok(frame) => {
                if emit_pipeline_metrics && !saw_audio {
                    saw_audio = true;
                    let _ = event_tx.send(BackendEvent::Metric {
                        name: "audio_started_at",
                        utterance_id: None,
                        at_ms: clock.elapsed_ms(),
                    });
                }

                if let Some(batcher) = batchers.get_mut(&frame.source) {
                    for output in batcher.push_frame(frame) {
                        send_pipeline_output(&job_tx, output);
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        drain_events(&event_rx);
    }

    drop(microphone_capture);

    for batcher in batchers.values_mut() {
        if let Some(segment) = batcher.flush() {
            let _ = job_tx.send(TranscriptionJob::Segment(segment));
        }
    }

    let _ = job_tx.send(TranscriptionJob::Stop);

    if let Some(handle) = system_thread {
        let _ = handle.join();
    }

    let _ = transcription_thread.join();
    drain_events(&event_rx);
    emit_event(BackendEvent::Stage(
        "local transcription stopped".to_string(),
    ));

    Ok(())
}

pub fn run_daemon() -> Result<(), Box<dyn std::error::Error>> {
    let running = Arc::new(AtomicBool::new(true));
    let signal_running = running.clone();
    ctrlc::set_handler(move || {
        signal_running.store(false, Ordering::SeqCst);
    })?;

    let clock = PipelineClock::new();
    let (audio_tx, audio_rx) = mpsc::channel::<AudioFrame>();
    let (event_tx, event_rx) = mpsc::channel::<BackendEvent>();
    let (job_tx, job_rx) = mpsc::channel::<TranscriptionJob>();
    let (command_tx, command_rx) = mpsc::channel::<DaemonCommand>();
    let transcription_events = event_tx.clone();
    let transcription_clock = clock.clone();
    let transcription_thread = thread::spawn(move || {
        run_transcription_worker(job_rx, transcription_events, transcription_clock);
    });

    start_daemon_stdin_thread(command_tx, running.clone());
    event_tx.send(BackendEvent::Stage(
        "local Parakeet warm daemon started".to_string(),
    ))?;

    let mut session: Option<ActiveSession> = None;
    let emit_pipeline_metrics = pipeline_metrics_enabled();

    while running.load(Ordering::SeqCst) {
        while let Ok(command) = command_rx.try_recv() {
            match command {
                DaemonCommand::Prepare { sources } => {
                    if !sources.is_empty() {
                        let _ = job_tx.send(TranscriptionJob::Warmup);
                        prepare_active_session(
                            &mut session,
                            sources,
                            &clock,
                            &audio_tx,
                            &event_tx,
                            &job_tx,
                        )?;
                    }
                }
                DaemonCommand::Start { sources } => {
                    if sources.is_empty() {
                        event_tx.send(BackendEvent::Error(
                            "Select at least one audio source.".to_string(),
                        ))?;
                    } else {
                        drain_audio_frames(&audio_rx);
                        start_or_activate_session(
                            &mut session,
                            sources,
                            &clock,
                            &audio_tx,
                            &event_tx,
                            &job_tx,
                        )?;
                    }
                }
                DaemonCommand::Stop => {
                    pause_active_session(&mut session, &clock, &job_tx, &event_tx);
                }
                DaemonCommand::Quit => {
                    running.store(false, Ordering::SeqCst);
                }
            }

            drain_events(&event_rx);
        }

        match audio_rx.recv_timeout(Duration::from_millis(25)) {
            Ok(frame) => {
                if let Some(active_session) = session.as_mut() {
                    if !active_session.accepting_audio {
                        continue;
                    }

                    if emit_pipeline_metrics && !active_session.saw_audio {
                        active_session.saw_audio = true;
                        let _ = event_tx.send(BackendEvent::Metric {
                            name: "audio_started_at",
                            utterance_id: None,
                            at_ms: clock.elapsed_ms(),
                        });
                    }

                    if let Some(batcher) = active_session.batchers.get_mut(&frame.source) {
                        for output in batcher.push_frame(frame) {
                            send_pipeline_output(&job_tx, output);
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        drain_events(&event_rx);
    }

    stop_active_session(&mut session, &job_tx, &event_tx);
    let _ = job_tx.send(TranscriptionJob::Stop);
    let _ = transcription_thread.join();
    drain_events(&event_rx);
    emit_event(BackendEvent::Stage(
        "local Parakeet warm daemon stopped".to_string(),
    ));

    Ok(())
}

struct ActiveSession {
    _microphone_capture: Option<MicrophoneCapture>,
    system_thread: Option<thread::JoinHandle<()>>,
    running: Arc<AtomicBool>,
    batchers: HashMap<TranscriptSource, SourcePipeline>,
    sources: Vec<TranscriptSource>,
    accepting_audio: bool,
    saw_audio: bool,
}

fn start_active_session(
    sources: Vec<TranscriptSource>,
    clock: &PipelineClock,
    audio_tx: &Sender<AudioFrame>,
    event_tx: &Sender<BackendEvent>,
    accepting_audio: bool,
) -> Result<ActiveSession, Box<dyn std::error::Error>> {
    let running = Arc::new(AtomicBool::new(true));
    let mut microphone_capture = None;
    let mut system_thread = None;

    if sources.contains(&TranscriptSource::Microphone) {
        event_tx.send(BackendEvent::Stage(
            "starting microphone capture".to_string(),
        ))?;
        microphone_capture = Some(MicrophoneCapture::start(
            audio_tx.clone(),
            event_tx.clone(),
        )?);
    }

    if sources.contains(&TranscriptSource::System) {
        event_tx.send(BackendEvent::Stage(
            "starting system audio capture".to_string(),
        ))?;
        let repository_root = std::env::current_dir()?;
        system_thread = Some(start_system_audio_thread(
            repository_root,
            audio_tx.clone(),
            event_tx.clone(),
            running.clone(),
        ));
    }

    let endpoint_config = EndpointConfig::from_environment();
    let partial_gate = Arc::new(AtomicBool::new(false));
    let batchers = sources
        .iter()
        .copied()
        .map(|source| {
            (
                source,
                SourcePipeline::with_partial_gate(
                    source,
                    clock.clone(),
                    endpoint_config,
                    partial_gate.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();

    event_tx.send(BackendEvent::Stage(
        "local Parakeet capture started".to_string(),
    ))?;

    Ok(ActiveSession {
        _microphone_capture: microphone_capture,
        system_thread,
        running,
        batchers,
        sources,
        accepting_audio,
        saw_audio: false,
    })
}

fn start_or_activate_session(
    session: &mut Option<ActiveSession>,
    sources: Vec<TranscriptSource>,
    clock: &PipelineClock,
    audio_tx: &Sender<AudioFrame>,
    event_tx: &Sender<BackendEvent>,
    job_tx: &Sender<TranscriptionJob>,
) -> Result<(), Box<dyn std::error::Error>> {
    let can_reuse = session
        .as_ref()
        .is_some_and(|active_session| active_session.sources == sources);

    if !can_reuse {
        stop_active_session(session, job_tx, event_tx);
        *session = Some(start_active_session(
            sources, clock, audio_tx, event_tx, true,
        )?);
        return Ok(());
    }

    if let Some(active_session) = session.as_mut() {
        active_session.accepting_audio = true;
        active_session.saw_audio = false;
        active_session.reset_batchers(clock);
        event_tx.send(BackendEvent::Stage(
            "local Parakeet capture started".to_string(),
        ))?;
    }

    Ok(())
}

fn drain_audio_frames(receiver: &mpsc::Receiver<AudioFrame>) {
    while receiver.try_recv().is_ok() {}
}

fn prepare_active_session(
    session: &mut Option<ActiveSession>,
    sources: Vec<TranscriptSource>,
    clock: &PipelineClock,
    audio_tx: &Sender<AudioFrame>,
    event_tx: &Sender<BackendEvent>,
    job_tx: &Sender<TranscriptionJob>,
) -> Result<(), Box<dyn std::error::Error>> {
    let can_reuse = session
        .as_ref()
        .is_some_and(|active_session| active_session.sources == sources);

    if !can_reuse {
        stop_active_session(session, job_tx, event_tx);
        *session = Some(start_active_session(
            sources, clock, audio_tx, event_tx, false,
        )?);
        return Ok(());
    }

    if let Some(active_session) = session.as_mut() {
        active_session.accepting_audio = false;
        active_session.saw_audio = false;
        active_session.reset_batchers(clock);
        event_tx.send(BackendEvent::Stage(
            "local Parakeet hot capture prepared".to_string(),
        ))?;
    }

    Ok(())
}

impl ActiveSession {
    fn reset_batchers(&mut self, clock: &PipelineClock) {
        let endpoint_config = EndpointConfig::from_environment();
        let partial_gate = Arc::new(AtomicBool::new(false));
        self.batchers = self
            .sources
            .iter()
            .copied()
            .map(|source| {
                (
                    source,
                    SourcePipeline::with_partial_gate(
                        source,
                        clock.clone(),
                        endpoint_config,
                        partial_gate.clone(),
                    ),
                )
            })
            .collect::<HashMap<_, _>>();
    }
}

fn stop_active_session(
    session: &mut Option<ActiveSession>,
    job_tx: &Sender<TranscriptionJob>,
    event_tx: &Sender<BackendEvent>,
) {
    let Some(mut active_session) = session.take() else {
        return;
    };

    active_session.running.store(false, Ordering::SeqCst);
    drop(active_session._microphone_capture.take());

    for batcher in active_session.batchers.values_mut() {
        if let Some(segment) = batcher.flush() {
            let _ = job_tx.send(TranscriptionJob::Segment(segment));
        }
    }

    let (barrier_tx, barrier_rx) = mpsc::channel();
    let _ = job_tx.send(TranscriptionJob::Barrier(barrier_tx));
    let _ = barrier_rx.recv_timeout(Duration::from_secs(5));

    if let Some(handle) = active_session.system_thread.take() {
        let _ = handle.join();
    }

    let _ = event_tx.send(BackendEvent::Stage(
        "local transcription stopped".to_string(),
    ));
}

fn pause_active_session(
    session: &mut Option<ActiveSession>,
    clock: &PipelineClock,
    job_tx: &Sender<TranscriptionJob>,
    event_tx: &Sender<BackendEvent>,
) {
    let Some(active_session) = session.as_mut() else {
        return;
    };

    for batcher in active_session.batchers.values_mut() {
        if let Some(segment) = batcher.flush() {
            let _ = job_tx.send(TranscriptionJob::Segment(segment));
        }
    }

    let (barrier_tx, barrier_rx) = mpsc::channel();
    let _ = job_tx.send(TranscriptionJob::Barrier(barrier_tx));
    let _ = barrier_rx.recv_timeout(Duration::from_secs(5));

    active_session.accepting_audio = false;
    active_session.saw_audio = false;
    active_session.reset_batchers(clock);

    let _ = event_tx.send(BackendEvent::Stage(
        "local transcription stopped".to_string(),
    ));
}

fn send_pipeline_output(job_tx: &Sender<TranscriptionJob>, output: PipelineOutput) {
    let job = match output {
        PipelineOutput::Preview(preview) => TranscriptionJob::Partial(preview),
        PipelineOutput::Segment(segment) => TranscriptionJob::Segment(segment),
    };

    let _ = job_tx.send(job);
}

fn start_daemon_stdin_thread(sender: Sender<DaemonCommand>, running: Arc<AtomicBool>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines().map_while(Result::ok) {
            if let Some(command) = parse_daemon_command(&line) {
                let should_quit = matches!(command, DaemonCommand::Quit);
                let _ = sender.send(command);

                if should_quit {
                    running.store(false, Ordering::SeqCst);
                    break;
                }
            }
        }
    });
}

fn parse_daemon_command(line: &str) -> Option<DaemonCommand> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    let command_type = value.get("type").and_then(Value::as_str)?;

    match command_type {
        "prepare" => {
            let sources = parse_command_sources(&value);

            Some(DaemonCommand::Prepare { sources })
        }
        "start" => {
            let sources = parse_command_sources(&value);

            Some(DaemonCommand::Start { sources })
        }
        "stop" => Some(DaemonCommand::Stop),
        "quit" => Some(DaemonCommand::Quit),
        _ => None,
    }
}

fn parse_command_sources(value: &Value) -> Vec<TranscriptSource> {
    value
        .get("sources")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(TranscriptSource::parse)
        .fold(Vec::new(), |mut sources, source| {
            if !sources.contains(&source) {
                sources.push(source);
            }

            sources
        })
}

pub fn run_fixture_pipeline_smoke() {
    let cases = [
        ("short_question", 700, 700),
        ("short_statement", 650, 700),
        ("clause_pause", 400, 300),
        ("silence_only", 0, 1_200),
    ];

    for (name, speech_ms, silence_ms) in cases {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(clock, EndpointConfig::from_environment());
        let mut segments = Vec::new();

        if speech_ms > 0 {
            collect_segments_into(
                &mut segments,
                pipeline.push_frame(AudioFrame {
                    source: TranscriptSource::System,
                    sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
                    channels: 1,
                    samples: vec![0.05; ms_to_samples(speech_ms) as usize],
                }),
            );
        }

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(AudioFrame {
                source: TranscriptSource::System,
                sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
                channels: 1,
                samples: vec![0.0; ms_to_samples(silence_ms) as usize],
            }),
        );

        if segments.is_empty() {
            if let Some(segment) = pipeline.flush() {
                segments.push(segment);
            }
        }

        for segment in &segments {
            println!(
                "{}",
                json!({
                    "type": "fixture_pipeline_metric",
                    "case": name,
                    "utterance_id": segment.id,
                    "start_ms": segment.start_ms,
                    "end_ms": segment.end_ms,
                    "endpoint_reason": segment.endpoint_reason.as_str(),
                    "vad_speech_started_at": segment.metrics.vad_speech_started_at_ms,
                    "vad_endpoint_at": segment.metrics.vad_endpoint_at_ms,
                    "asr_queued_at": segment.metrics.asr_queued_at_ms
                })
            );
        }

        println!(
            "{}",
            json!({
                "type": "fixture_pipeline_summary",
                "case": name,
                "utterance_count": segments.len()
            })
        );
    }
}

fn collect_segments_into(segments: &mut Vec<SpeechSegment>, outputs: Vec<PipelineOutput>) {
    segments.extend(outputs.into_iter().filter_map(|output| match output {
        PipelineOutput::Segment(segment) => Some(segment),
        PipelineOutput::Preview(_) => None,
    }));
}

pub fn run_parakeet_wav_benchmark(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let clock = PipelineClock::new();
    let audio_read_started_at_ms = clock.elapsed_ms();
    let samples = read_mono_16khz_wav(path)?;
    let audio_read_completed_at_ms = clock.elapsed_ms();
    let audio_duration_ms = samples_to_ms(samples.len() as u64);

    let model_load_started_at_ms = clock.elapsed_ms();
    let model_dir = ensure_parakeet_model()?;
    let mut model = ParakeetModel::load(&model_dir, &Quantization::Int8)?;
    let model_load_completed_at_ms = clock.elapsed_ms();

    let asr_started_at_ms = clock.elapsed_ms();
    let params = ParakeetParams {
        timestamp_granularity: Some(TimestampGranularity::Segment),
        ..Default::default()
    };
    let result = model.transcribe_with(&samples, &params)?;
    let asr_completed_at_ms = clock.elapsed_ms();
    let text = result.text.trim().to_string();
    let stats = audio_stats(&samples);

    println!(
        "{}",
        json!({
            "type": "parakeet_direct_bench",
            "path": path.display().to_string(),
            "sample_rate_hz": OUTPUT_SAMPLE_RATE_HZ,
            "samples": samples.len(),
            "audio_duration_ms": audio_duration_ms,
            "audio_read_started_at_ms": audio_read_started_at_ms,
            "audio_read_completed_at_ms": audio_read_completed_at_ms,
            "model_load_started_at_ms": model_load_started_at_ms,
            "model_load_completed_at_ms": model_load_completed_at_ms,
            "asr_started_at_ms": asr_started_at_ms,
            "asr_completed_at_ms": asr_completed_at_ms,
            "audio_read_ms": audio_read_completed_at_ms.saturating_sub(audio_read_started_at_ms),
            "model_load_ms": model_load_completed_at_ms.saturating_sub(model_load_started_at_ms),
            "asr_ms": asr_completed_at_ms.saturating_sub(asr_started_at_ms),
            "rms": stats.rms,
            "peak": stats.peak,
            "transcript": text
        })
    );

    Ok(())
}

fn read_mono_16khz_wav(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();

    if spec.channels != 1 {
        return Err(format!(
            "expected mono WAV, got {} channels in {}",
            spec.channels,
            path.display()
        )
        .into());
    }

    if spec.sample_rate != OUTPUT_SAMPLE_RATE_HZ {
        return Err(format!(
            "expected {} Hz WAV, got {} Hz in {}",
            OUTPUT_SAMPLE_RATE_HZ,
            spec.sample_rate,
            path.display()
        )
        .into());
    }

    let samples = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|sample| sample.map(|value| value as f32 / i16::MAX as f32))
            .collect::<Result<Vec<_>, _>>()?,
        (hound::SampleFormat::Float, 32) => {
            reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?
        }
        _ => {
            return Err(format!(
                "unsupported WAV format {:?} {} bit in {}",
                spec.sample_format,
                spec.bits_per_sample,
                path.display()
            )
            .into());
        }
    };

    Ok(samples)
}

#[derive(Clone, Copy, Debug)]
struct AudioStats {
    rms: f32,
    peak: f32,
}

fn audio_stats(samples: &[f32]) -> AudioStats {
    if samples.is_empty() {
        return AudioStats {
            rms: 0.0,
            peak: 0.0,
        };
    }

    let mut sum_squares = 0.0;
    let mut peak = 0.0_f32;

    for sample in samples {
        sum_squares += sample * sample;
        peak = peak.max(sample.abs());
    }

    AudioStats {
        rms: (sum_squares / samples.len() as f32).sqrt(),
        peak,
    }
}

fn write_mono_16khz_wav(path: &Path, samples: &[f32]) -> Result<(), Box<dyn std::error::Error>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: OUTPUT_SAMPLE_RATE_HZ,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        writer.write_sample(value)?;
    }

    writer.finalize()?;
    Ok(())
}

#[derive(Clone, Debug)]
struct PipelineClock {
    started_at: Arc<Instant>,
}

impl PipelineClock {
    fn new() -> Self {
        Self {
            started_at: Arc::new(Instant::now()),
        }
    }

    fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}

fn start_stdin_stop_thread(running: Arc<AtomicBool>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines().map_while(Result::ok) {
            if line.contains("\"stop\"") || line.contains("\"quit\"") {
                running.store(false, Ordering::SeqCst);
                break;
            }
        }
    });
}

fn start_system_audio_thread(
    repository_root: PathBuf,
    audio_tx: Sender<AudioFrame>,
    event_tx: Sender<BackendEvent>,
    running: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let Ok((mut capture, receiver)) =
            RunningSystemAudio::start(repository_root, false)
        else {
            let _ = event_tx.send(BackendEvent::Error(
                "System audio capture is currently unavailable.".to_string(),
            ));
            return;
        };

        while running.load(Ordering::SeqCst) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(SystemAudioUpdate::Started { .. }) => {
                    let _ = event_tx.send(BackendEvent::Stage(
                        system_audio_started_stage(),
                    ));
                }
                Ok(SystemAudioUpdate::Stage(message)) => {
                    let _ = event_tx.send(BackendEvent::Stage(message));
                }
                Ok(SystemAudioUpdate::AudioFrame {
                    sample_rate_hz,
                    channels,
                    pcm16_base64,
                }) => match decode_pcm16_base64(&pcm16_base64) {
                    Ok(samples) => {
                        let _ = audio_tx.send(AudioFrame {
                            source: TranscriptSource::System,
                            sample_rate_hz,
                            channels,
                            samples,
                        });
                    }
                    Err(error) => {
                        let _ = event_tx.send(BackendEvent::Error(error));
                    }
                },
                Ok(SystemAudioUpdate::Error(message)) => {
                    let _ = event_tx.send(BackendEvent::Error(message));
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        capture.stop();
    })
}

fn decode_pcm16_base64(encoded: &str) -> Result<Vec<f32>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("System audio frame was not valid base64: {error}"))?;

    if bytes.len() % 2 != 0 {
        return Err("System audio frame had an odd byte length.".to_string());
    }

    Ok(bytes
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
        .collect())
}

fn system_audio_started_stage() -> String {
    if cfg!(target_os = "macos") {
        "Core Audio capture started".to_string()
    } else if cfg!(target_os = "windows") {
        "WASAPI loopback capture started".to_string()
    } else if cfg!(target_os = "linux") {
        "Pulse/PipeWire monitor capture started".to_string()
    } else {
        "system audio capture started".to_string()
    }
}

struct MicrophoneCapture {
    _stream: cpal::Stream,
}

impl MicrophoneCapture {
    fn start(
        audio_tx: Sender<AudioFrame>,
        event_tx: Sender<BackendEvent>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No default microphone input device is available")?;
        let config = device.default_input_config()?;
        let sample_rate_hz = config.sample_rate();
        let channels = config.channels();
        let stream_config = cpal::StreamConfig {
            channels,
            sample_rate: config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };
        let error_events = event_tx.clone();
        let err_fn = move |error| {
            let _ = error_events.send(BackendEvent::Error(format!(
                "Microphone capture failed: {error}"
            )));
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => build_input_stream::<f32>(
                &device,
                &stream_config,
                audio_tx,
                sample_rate_hz,
                channels,
                err_fn,
            )?,
            cpal::SampleFormat::I16 => build_input_stream::<i16>(
                &device,
                &stream_config,
                audio_tx,
                sample_rate_hz,
                channels,
                err_fn,
            )?,
            cpal::SampleFormat::U16 => build_input_stream::<u16>(
                &device,
                &stream_config,
                audio_tx,
                sample_rate_hz,
                channels,
                err_fn,
            )?,
            sample_format => {
                return Err(
                    format!("Unsupported microphone sample format: {sample_format:?}").into(),
                );
            }
        };

        stream.play()?;
        event_tx.send(BackendEvent::Stage(
            "microphone capture started".to_string(),
        ))?;

        Ok(Self { _stream: stream })
    }
}

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

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    audio_tx: Sender<AudioFrame>,
    sample_rate_hz: u32,
    channels: u16,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample + ToFloatSample,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let samples = data
                .iter()
                .map(|sample| ToFloatSample::to_float_sample(*sample))
                .collect();
            let _ = audio_tx.send(AudioFrame {
                source: TranscriptSource::Microphone,
                sample_rate_hz,
                channels,
                samples,
            });
        },
        err_fn,
        None,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EndpointReason {
    Silence,
    MaxDuration,
    Stop,
}

impl EndpointReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Silence => "silence",
            Self::MaxDuration => "max_duration",
            Self::Stop => "stop",
        }
    }
}

#[derive(Clone, Debug, Default)]
struct PipelineTimings {
    vad_speech_started_at_ms: Option<u64>,
    vad_endpoint_at_ms: Option<u64>,
    asr_queued_at_ms: Option<u64>,
    asr_started_at_ms: Option<u64>,
    asr_completed_at_ms: Option<u64>,
}

struct SourcePipeline {
    source: TranscriptSource,
    clock: PipelineClock,
    resampler: StreamResampler,
    endpoint: EndpointDetector,
    next_utterance_id: u64,
    active_utterance_id: Option<u64>,
    last_partial_end_sample: u64,
    partial_gate: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
enum PipelineOutput {
    Preview(SpeechPreview),
    Segment(SpeechSegment),
}

impl SourcePipeline {
    fn new(clock: PipelineClock, endpoint_config: EndpointConfig) -> Self {
        Self::with_partial_gate(
            TranscriptSource::System,
            clock,
            endpoint_config,
            Arc::new(AtomicBool::new(false)),
        )
    }

    fn with_partial_gate(
        source: TranscriptSource,
        clock: PipelineClock,
        endpoint_config: EndpointConfig,
        partial_gate: Arc<AtomicBool>,
    ) -> Self {
        Self {
            source,
            clock,
            resampler: StreamResampler::new(),
            endpoint: EndpointDetector::new(endpoint_config),
            next_utterance_id: 1,
            active_utterance_id: None,
            last_partial_end_sample: 0,
            partial_gate,
        }
    }

    fn push_frame(&mut self, frame: AudioFrame) -> Vec<PipelineOutput> {
        let samples = self.resampler.push(&frame);
        let mut outputs = self
            .endpoint
            .push_samples(&samples, &self.clock)
            .into_iter()
            .map(|utterance| self.segment_from_utterance(utterance))
            .map(PipelineOutput::Segment)
            .collect::<Vec<_>>();

        if outputs.is_empty() {
            if let Some(preview) = self.maybe_preview() {
                outputs.push(PipelineOutput::Preview(preview));
            }
        }

        outputs
    }

    fn flush(&mut self) -> Option<SpeechSegment> {
        let remaining = self.resampler.finish();
        let mut utterances = self.endpoint.push_samples(&remaining, &self.clock);

        if utterances.is_empty() {
            if let Some(utterance) = self.endpoint.flush(&self.clock) {
                utterances.push(utterance);
            }
        }

        utterances
            .into_iter()
            .next()
            .map(|utterance| self.segment_from_utterance(utterance))
    }

    fn segment_from_utterance(&mut self, utterance: ClosedUtterance) -> SpeechSegment {
        let id = self
            .active_utterance_id
            .take()
            .unwrap_or(self.next_utterance_id);
        self.next_utterance_id = self.next_utterance_id.max(id + 1);
        self.last_partial_end_sample = 0;
        self.partial_gate.store(false, Ordering::SeqCst);

        let mut metrics = utterance.metrics;
        metrics.asr_queued_at_ms = Some(self.clock.elapsed_ms());

        SpeechSegment {
            source: self.source,
            id,
            start_ms: samples_to_ms(utterance.start_sample),
            end_ms: samples_to_ms(utterance.end_sample),
            endpoint_reason: utterance.endpoint_reason,
            metrics,
            samples: utterance.samples,
        }
    }

    fn maybe_preview(&mut self) -> Option<SpeechPreview> {
        let snapshot = self.endpoint.active_snapshot()?;
        let active_duration = snapshot.end_sample.saturating_sub(snapshot.start_sample);

        if active_duration < ms_to_samples(LIVE_PARTIAL_MIN_MS) {
            return None;
        }

        if snapshot
            .end_sample
            .saturating_sub(self.last_partial_end_sample)
            < ms_to_samples(LIVE_PARTIAL_INTERVAL_MS)
        {
            return None;
        }

        if self.active_utterance_id.is_none() {
            self.active_utterance_id = Some(self.next_utterance_id);
        }

        if self
            .partial_gate
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return None;
        }

        self.last_partial_end_sample = snapshot.end_sample;

        Some(SpeechPreview {
            source: self.source,
            id: self.active_utterance_id.expect("active preview id exists"),
            start_ms: samples_to_ms(snapshot.start_sample),
            end_ms: samples_to_ms(snapshot.end_sample),
            queued_at_ms: self.clock.elapsed_ms(),
            partial_gate: self.partial_gate.clone(),
            samples: snapshot.samples,
        })
    }
}

#[derive(Clone, Copy, Debug)]
struct EndpointConfig {
    frame_samples: usize,
    pre_roll_samples: usize,
    min_speech_samples: usize,
    end_silence_samples: usize,
    max_utterance_samples: usize,
    energy_threshold: f32,
}

impl Default for EndpointConfig {
    fn default() -> Self {
        Self {
            frame_samples: VAD_FRAME_SAMPLES,
            pre_roll_samples: ms_to_samples(PRE_ROLL_MS) as usize,
            min_speech_samples: ms_to_samples(MIN_SPEECH_MS) as usize,
            end_silence_samples: ms_to_samples(END_SILENCE_MS) as usize,
            max_utterance_samples: ms_to_samples(MAX_UTTERANCE_MS) as usize,
            energy_threshold: ENERGY_SPEECH_THRESHOLD,
        }
    }
}

impl EndpointConfig {
    fn from_environment() -> Self {
        let mut config = Self::default();

        if let Some(end_silence_ms) = env_u64("SUSURA_ENDPOINT_END_SILENCE_MS") {
            config.end_silence_samples = ms_to_samples(end_silence_ms) as usize;
        }

        config
    }
}

#[derive(Debug)]
struct ClosedUtterance {
    start_sample: u64,
    end_sample: u64,
    endpoint_reason: EndpointReason,
    metrics: PipelineTimings,
    samples: Vec<f32>,
}

#[derive(Debug)]
struct ActiveUtterance {
    start_sample: u64,
    last_speech_end_sample: u64,
    speech_samples: usize,
    trailing_silence_samples: usize,
    samples: Vec<f32>,
    metrics: PipelineTimings,
}

#[derive(Debug)]
struct ActiveUtteranceSnapshot {
    start_sample: u64,
    end_sample: u64,
    samples: Vec<f32>,
}

struct EndpointDetector {
    config: EndpointConfig,
    pending: Vec<f32>,
    pre_roll: Vec<f32>,
    active: Option<ActiveUtterance>,
    total_samples: u64,
}

impl EndpointDetector {
    fn new(config: EndpointConfig) -> Self {
        Self {
            config,
            pending: Vec::new(),
            pre_roll: Vec::new(),
            active: None,
            total_samples: 0,
        }
    }

    fn push_samples(&mut self, samples: &[f32], clock: &PipelineClock) -> Vec<ClosedUtterance> {
        self.pending.extend_from_slice(samples);
        let mut utterances = Vec::new();

        while self.pending.len() >= self.config.frame_samples {
            let frame = self
                .pending
                .drain(..self.config.frame_samples)
                .collect::<Vec<_>>();
            if let Some(utterance) = self.process_frame(frame, clock) {
                utterances.push(utterance);
            }
        }

        utterances
    }

    fn active_snapshot(&self) -> Option<ActiveUtteranceSnapshot> {
        let active = self.active.as_ref()?;

        Some(ActiveUtteranceSnapshot {
            start_sample: active.start_sample,
            end_sample: active.start_sample + active.samples.len() as u64,
            samples: active.samples.clone(),
        })
    }

    fn flush(&mut self, clock: &PipelineClock) -> Option<ClosedUtterance> {
        if !self.pending.is_empty() {
            let remaining = std::mem::take(&mut self.pending);
            if let Some(active) = self.active.as_mut() {
                active.samples.extend_from_slice(&remaining);
            }
            self.total_samples += remaining.len() as u64;
        }

        self.finish_active(EndpointReason::Stop, clock, true)
    }

    fn process_frame(&mut self, frame: Vec<f32>, clock: &PipelineClock) -> Option<ClosedUtterance> {
        let frame_start = self.total_samples;
        self.total_samples += frame.len() as u64;
        let is_speech = frame_rms(&frame) >= self.config.energy_threshold;

        if self.active.is_none() {
            self.push_pre_roll(&frame);

            if is_speech {
                let start_sample = frame_start
                    .saturating_sub(self.pre_roll.len().saturating_sub(frame.len()) as u64);
                let samples = self.pre_roll.clone();
                self.pre_roll.clear();

                self.active = Some(ActiveUtterance {
                    start_sample,
                    last_speech_end_sample: self.total_samples,
                    speech_samples: frame.len(),
                    trailing_silence_samples: 0,
                    samples,
                    metrics: PipelineTimings {
                        vad_speech_started_at_ms: Some(clock.elapsed_ms()),
                        ..Default::default()
                    },
                });
            }

            return None;
        }

        let active = self.active.as_mut().expect("active utterance exists");
        active.samples.extend_from_slice(&frame);

        if is_speech {
            active.last_speech_end_sample = self.total_samples;
            active.trailing_silence_samples = 0;
            active.speech_samples += frame.len();
        } else {
            active.trailing_silence_samples += frame.len();
        }

        if active.samples.len() >= self.config.max_utterance_samples {
            return self.finish_active(EndpointReason::MaxDuration, clock, true);
        }

        if active.trailing_silence_samples >= self.config.end_silence_samples {
            return self.finish_active(EndpointReason::Silence, clock, false);
        }

        None
    }

    fn push_pre_roll(&mut self, frame: &[f32]) {
        self.pre_roll.extend_from_slice(frame);
        if self.pre_roll.len() > self.config.pre_roll_samples {
            let excess = self.pre_roll.len() - self.config.pre_roll_samples;
            self.pre_roll.drain(..excess);
        }
    }

    fn finish_active(
        &mut self,
        reason: EndpointReason,
        clock: &PipelineClock,
        force: bool,
    ) -> Option<ClosedUtterance> {
        let mut active = self.active.take()?;

        if !force && active.speech_samples < self.config.min_speech_samples {
            return None;
        }

        if reason == EndpointReason::Silence
            && active.trailing_silence_samples > 0
            && active.samples.len() > active.trailing_silence_samples
        {
            active
                .samples
                .truncate(active.samples.len() - active.trailing_silence_samples);
        }

        active.metrics.vad_endpoint_at_ms = Some(clock.elapsed_ms());
        let end_sample = match reason {
            EndpointReason::Silence => active.last_speech_end_sample,
            EndpointReason::MaxDuration | EndpointReason::Stop => {
                active.start_sample + active.samples.len() as u64
            }
        };

        Some(ClosedUtterance {
            start_sample: active.start_sample,
            end_sample,
            endpoint_reason: reason,
            metrics: active.metrics,
            samples: active.samples,
        })
    }
}

fn frame_rms(frame: &[f32]) -> f32 {
    (frame.iter().map(|sample| sample * sample).sum::<f32>() / frame.len().max(1) as f32).sqrt()
}

struct StreamResampler {
    sample_rate_hz: u32,
    channels: u16,
    pending_mono: Vec<f32>,
    input_chunk: Vec<f32>,
    resampler: Option<FftFixedIn<f32>>,
}

impl StreamResampler {
    fn new() -> Self {
        Self {
            sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
            channels: 1,
            pending_mono: Vec::new(),
            input_chunk: Vec::new(),
            resampler: None,
        }
    }

    fn push(&mut self, frame: &AudioFrame) -> Vec<f32> {
        if frame.sample_rate_hz == 0 || frame.channels == 0 {
            return Vec::new();
        }

        if frame.sample_rate_hz != self.sample_rate_hz || frame.channels != self.channels {
            self.sample_rate_hz = frame.sample_rate_hz;
            self.channels = frame.channels;
            self.pending_mono.clear();
            self.input_chunk.clear();
            self.resampler = if self.sample_rate_hz == OUTPUT_SAMPLE_RATE_HZ {
                None
            } else {
                Some(
                    FftFixedIn::<f32>::new(
                        self.sample_rate_hz as usize,
                        OUTPUT_SAMPLE_RATE_HZ as usize,
                        RESAMPLER_CHUNK_SIZE,
                        1,
                        1,
                    )
                    .expect("failed to create audio resampler"),
                )
            };
        }

        self.pending_mono
            .extend(downmix_to_mono(&frame.samples, frame.channels));

        if self.sample_rate_hz == OUTPUT_SAMPLE_RATE_HZ {
            return std::mem::take(&mut self.pending_mono);
        }

        let mut output = Vec::new();
        self.input_chunk
            .extend(std::mem::take(&mut self.pending_mono));

        while self.input_chunk.len() >= RESAMPLER_CHUNK_SIZE {
            let chunk = self
                .input_chunk
                .drain(..RESAMPLER_CHUNK_SIZE)
                .collect::<Vec<_>>();

            if let Some(resampler) = self.resampler.as_mut() {
                if let Ok(resampled) = resampler.process(&[&chunk], None) {
                    output.extend_from_slice(&resampled[0]);
                }
            }
        }

        output
    }

    fn finish(&mut self) -> Vec<f32> {
        if self.input_chunk.is_empty() {
            return Vec::new();
        }

        if self.resampler.is_none() {
            return std::mem::take(&mut self.input_chunk);
        }

        self.input_chunk.resize(RESAMPLER_CHUNK_SIZE, 0.0);
        let chunk = std::mem::take(&mut self.input_chunk);

        self.resampler
            .as_mut()
            .and_then(|resampler| resampler.process(&[&chunk], None).ok())
            .map(|output| output[0].clone())
            .unwrap_or_default()
    }
}

fn downmix_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;

    if channels == 1 {
        return samples.to_vec();
    }

    samples
        .chunks(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / frame.len() as f32)
        .collect()
}

fn run_transcription_worker(
    receiver: mpsc::Receiver<TranscriptionJob>,
    event_tx: Sender<BackendEvent>,
    clock: PipelineClock,
) {
    let selected_model = LocalTranscriptionModel::from_environment();
    let mut model: Option<LocalTranscriber> = None;
    let mut partial_stability = HashMap::<(TranscriptSource, u64), PartialStability>::new();
    if preload_local_transcription_enabled() {
        let _ = get_or_load_local_model(&mut model, selected_model, &event_tx);
    }

    while let Ok(job) = receiver.recv() {
        match job {
            TranscriptionJob::Warmup => {
                let _ = get_or_load_local_model(&mut model, selected_model, &event_tx);
            }
            TranscriptionJob::Partial(preview) => {
                emit_metric(
                    &event_tx,
                    "partial_asr_queued_at",
                    preview.id,
                    Some(preview.queued_at_ms),
                );

                let Some(model) = get_or_load_local_model(&mut model, selected_model, &event_tx) else {
                    preview.partial_gate.store(false, Ordering::SeqCst);
                    continue;
                };

                emit_metric(
                    &event_tx,
                    "partial_asr_started_at",
                    preview.id,
                    Some(clock.elapsed_ms()),
                );

                if let Some(text) = transcribe_samples(model, &preview.samples, &event_tx) {
                    emit_metric(
                        &event_tx,
                        "partial_asr_completed_at",
                        preview.id,
                        Some(clock.elapsed_ms()),
                    );
                    if let Some(stable_text) = stable_partial_text(
                        &mut partial_stability,
                        preview.source,
                        preview.id,
                        &text,
                    ) {
                        let stable_text = suppress_pathological_repetitions(&stable_text);
                        let _ = event_tx.send(BackendEvent::Partial {
                            source: preview.source,
                            utterance_id: preview.id,
                            start_ms: preview.start_ms,
                            end_ms: preview.end_ms,
                            text: stable_text,
                        });
                    }
                } else {
                    emit_metric(
                        &event_tx,
                        "partial_asr_empty_at",
                        preview.id,
                        Some(clock.elapsed_ms()),
                    );
                }

                preview.partial_gate.store(false, Ordering::SeqCst);
            }
            TranscriptionJob::Segment(mut segment) => {
                emit_metric(
                    &event_tx,
                    "vad_speech_started_at",
                    segment.id,
                    segment.metrics.vad_speech_started_at_ms,
                );
                emit_metric(
                    &event_tx,
                    "vad_endpoint_at",
                    segment.id,
                    segment.metrics.vad_endpoint_at_ms,
                );
                emit_metric(
                    &event_tx,
                    "asr_queued_at",
                    segment.id,
                    segment.metrics.asr_queued_at_ms,
                );

                let Some(model) = get_or_load_local_model(&mut model, selected_model, &event_tx) else {
                    continue;
                };

                dump_segment_audio_if_requested(&segment, &event_tx);

                segment.metrics.asr_started_at_ms = Some(clock.elapsed_ms());
                emit_metric(
                    &event_tx,
                    "asr_started_at",
                    segment.id,
                    segment.metrics.asr_started_at_ms,
                );

                if let Some(text) = transcribe_samples(model, &segment.samples, &event_tx) {
                    segment.metrics.asr_completed_at_ms = Some(clock.elapsed_ms());
                    emit_metric(
                        &event_tx,
                        "asr_completed_at",
                        segment.id,
                        segment.metrics.asr_completed_at_ms,
                    );

                    let text = suppress_pathological_repetitions(&final_text_with_stable_partial(
                        partial_stability.remove(&(segment.source, segment.id)),
                        text,
                    ));

                    let _ = event_tx.send(BackendEvent::Completed {
                        source: segment.source,
                        utterance_id: segment.id,
                        start_ms: segment.start_ms,
                        end_ms: segment.end_ms,
                        text: text.clone(),
                    });
                }
            }
            TranscriptionJob::Barrier(sender) => {
                let _ = sender.send(());
            }
            TranscriptionJob::Stop => break,
        }
    }
}

fn dump_segment_audio_if_requested(segment: &SpeechSegment, event_tx: &Sender<BackendEvent>) {
    let Ok(directory) = std::env::var("SUSURA_DUMP_UTTERANCE_DIR") else {
        return;
    };

    let directory = PathBuf::from(directory);
    if let Err(error) = fs::create_dir_all(&directory) {
        let _ = event_tx.send(BackendEvent::Error(format!(
            "Could not create utterance dump directory: {error}"
        )));
        return;
    }

    let path = directory.join(format!("utterance-{}.wav", segment.id));
    match write_mono_16khz_wav(&path, &segment.samples) {
        Ok(()) => {}
        Err(error) => {
            let _ = event_tx.send(BackendEvent::Error(format!(
                "Could not dump utterance audio: {error}"
            )));
        }
    }
}

fn emit_metric(
    event_tx: &Sender<BackendEvent>,
    name: &'static str,
    utterance_id: u64,
    at_ms: Option<u64>,
) {
    if !pipeline_metrics_enabled() {
        return;
    }

    if let Some(at_ms) = at_ms {
        let _ = event_tx.send(BackendEvent::Metric {
            name,
            utterance_id: Some(utterance_id),
            at_ms,
        });
    }
}

fn pipeline_metrics_enabled() -> bool {
    std::env::var("SUSURA_PIPELINE_METRICS").is_ok_and(|value| value == "1" || value == "true")
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
}

fn preload_local_transcription_enabled() -> bool {
    std::env::var("SUSURA_PRELOAD_LOCAL_TRANSCRIPTION")
        .or_else(|_| std::env::var("SUSURA_PRELOAD_PARAKEET"))
        .is_ok_and(|value| value == "1" || value == "true")
}

fn expected_speech_end_ms() -> Option<u64> {
    std::env::var("SUSURA_BENCH_EXPECTED_SPEECH_END_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LocalTranscriptionModel {
    Parakeet,
    MoonshineTiny,
}

impl LocalTranscriptionModel {
    fn from_environment() -> Self {
        match std::env::var("SUSURA_TRANSCRIPTION_MODEL")
            .unwrap_or_else(|_| "parakeet".to_string())
            .as_str()
        {
            "moonshine-tiny" | "moonshine" => Self::MoonshineTiny,
            _ => Self::Parakeet,
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Parakeet => "Parakeet",
            Self::MoonshineTiny => "Moonshine tiny",
        }
    }
}

enum LocalTranscriber {
    Parakeet(ParakeetModel),
    MoonshineTiny(StreamingModel),
}

fn get_or_load_local_model<'a>(
    model: &'a mut Option<LocalTranscriber>,
    selected_model: LocalTranscriptionModel,
    event_tx: &Sender<BackendEvent>,
) -> Option<&'a mut LocalTranscriber> {
    if model.is_none() {
        let _ = event_tx.send(BackendEvent::Stage(format!(
            "loading local {}",
            selected_model.display_name()
        )));
        match load_local_transcriber(selected_model) {
            Ok(loaded) => {
                *model = Some(loaded);
                let _ = event_tx.send(BackendEvent::Stage(format!(
                    "local {} loaded",
                    selected_model.display_name()
                )));
            }
            Err(error) => {
                let _ = event_tx.send(BackendEvent::Error(format!(
                    "Local {} model failed to load: {error}",
                    selected_model.display_name()
                )));
                return None;
            }
        }
    }

    model.as_mut()
}

fn load_local_transcriber(
    selected_model: LocalTranscriptionModel,
) -> Result<LocalTranscriber, Box<dyn std::error::Error>> {
    match selected_model {
        LocalTranscriptionModel::Parakeet => {
            let model_dir = ensure_parakeet_model()?;
            let model = ParakeetModel::load(&model_dir, &Quantization::Int8)?;
            Ok(LocalTranscriber::Parakeet(model))
        }
        LocalTranscriptionModel::MoonshineTiny => {
            let model_dir = ensure_moonshine_tiny_model()?;
            let model = StreamingModel::load(&model_dir, 2, &Quantization::default())?;
            Ok(LocalTranscriber::MoonshineTiny(model))
        }
    }
}

fn transcribe_samples(
    model: &mut LocalTranscriber,
    samples: &[f32],
    event_tx: &Sender<BackendEvent>,
) -> Option<String> {
    let result = match model {
        LocalTranscriber::Parakeet(model) => {
            let params = ParakeetParams {
                timestamp_granularity: Some(TimestampGranularity::Segment),
                ..Default::default()
            };
            model.transcribe_with(samples, &params)
        }
        LocalTranscriber::MoonshineTiny(model) => {
            let params = MoonshineStreamingParams::default();
            model.transcribe_with(samples, &params)
        }
    };

    match result {
        Ok(result) => {
            let text = result.text.trim().to_string();

            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Err(error) => {
            let _ = event_tx.send(BackendEvent::Error(format!(
                "Local transcription failed: {error}"
            )));
            None
        }
    }
}

fn stable_partial_text(
    partial_stability: &mut HashMap<(TranscriptSource, u64), PartialStability>,
    source: TranscriptSource,
    utterance_id: u64,
    raw_text: &str,
) -> Option<String> {
    let raw_text = raw_text.trim();
    let state = partial_stability.entry((source, utterance_id)).or_default();

    if state.previous_raw_text.is_empty() {
        state.previous_raw_text = raw_text.to_string();
        state.emitted_text = raw_text.to_string();
        return Some(raw_text.to_string());
    }

    let stable_text = common_word_prefix(&state.previous_raw_text, raw_text);
    state.previous_raw_text = raw_text.to_string();

    if stable_text.len() > state.emitted_text.len() {
        state.emitted_text = stable_text.clone();
        Some(stable_text)
    } else {
        None
    }
}

fn final_text_with_stable_partial(
    stability: Option<PartialStability>,
    final_text: String,
) -> String {
    let Some(stability) = stability else {
        return final_text;
    };

    let emitted_words = words(&stability.emitted_text);
    let final_words = words(&final_text);

    if emitted_words.is_empty() || final_words.len() != emitted_words.len() + 1 {
        return final_text;
    }

    if final_words[..emitted_words.len()] == emitted_words
        && final_words.last() == emitted_words.last()
    {
        stability.emitted_text
    } else {
        final_text
    }
}

fn suppress_pathological_repetitions(text: &str) -> String {
    let tokens = text.split_whitespace().collect::<Vec<_>>();

    if tokens.is_empty() {
        return String::new();
    }

    let mut output = Vec::with_capacity(tokens.len());
    let mut index = 0;

    while index < tokens.len() {
        let token = tokens[index];
        let key = repetition_key(token);
        let mut end = index + 1;

        while end < tokens.len() && repetition_key(tokens[end]) == key {
            end += 1;
        }

        let run_length = end - index;
        if is_pathological_repetition_key(&key) && run_length > 3 {
            output.extend_from_slice(&tokens[index..index + 2]);
        } else {
            output.extend_from_slice(&tokens[index..end]);
        }

        index = end;
    }

    output.join(" ")
}

fn repetition_key(token: &str) -> String {
    token
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_ascii_lowercase()
}

fn is_pathological_repetition_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 3
}

fn common_word_prefix(left: &str, right: &str) -> String {
    words(left)
        .into_iter()
        .zip(words(right))
        .take_while(|(left_word, right_word)| left_word == right_word)
        .map(|(word, _)| word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(ToString::to_string).collect()
}

fn ensure_parakeet_model() -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = std::env::var("SUSURA_PARAKEET_MODEL_DIR") {
        let path = PathBuf::from(path);
        validate_parakeet_dir(&path)?;
        return Ok(path);
    }

    let model_dir = model_root().join("parakeet-tdt-0.6b-v3-int8");
    if validate_parakeet_dir(&model_dir).is_ok() {
        return Ok(model_dir);
    }

    Err(format!(
        "local Parakeet model is not installed at {}",
        model_dir.display()
    )
    .into())
}

fn validate_parakeet_dir(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    for file_name in [
        "encoder-model.int8.onnx",
        "decoder_joint-model.int8.onnx",
        "nemo128.onnx",
        "vocab.txt",
    ] {
        let file_path = path.join(file_name);
        if !file_path.exists() {
            return Err(format!("missing Parakeet model file: {}", file_path.display()).into());
        }
    }

    Ok(())
}

fn ensure_moonshine_tiny_model() -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = std::env::var("SUSURA_MOONSHINE_MODEL_DIR") {
        let path = PathBuf::from(path);
        validate_moonshine_tiny_dir(&path)?;
        return Ok(path);
    }

    let model_dir = model_root().join("moonshine-tiny-streaming-en");
    validate_moonshine_tiny_dir(&model_dir)?;
    Ok(model_dir)
}

fn validate_moonshine_tiny_dir(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    for file_name in [
        "frontend.ort",
        "encoder.ort",
        "adapter.ort",
        "cross_kv.ort",
        "decoder_kv.ort",
        "streaming_config.json",
        "tokenizer.bin",
    ] {
        let file_path = path.join(file_name);
        if !file_path.exists() {
            return Err(format!("missing Moonshine model file: {}", file_path.display()).into());
        }
    }

    Ok(())
}

fn model_root() -> PathBuf {
    if let Ok(path) = std::env::var("SUSURA_MODEL_ROOT") {
        return PathBuf::from(path);
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Susura")
        .join("models")
}

fn drain_events(receiver: &mpsc::Receiver<BackendEvent>) {
    while let Ok(event) = receiver.try_recv() {
        emit_event(event);
    }
}

fn emit_event(event: BackendEvent) {
    let value = match event {
        BackendEvent::Partial {
            source,
            utterance_id,
            start_ms,
            end_ms,
            text,
        } => json!({
            "type": "transcription_partial",
            "source": source.as_str(),
            "utterance_id": utterance_id,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "text": text
        }),
        BackendEvent::Completed {
            source,
            utterance_id,
            start_ms,
            end_ms,
            text,
        } => json!({
            "type": "transcription_completed",
            "source": source.as_str(),
            "utterance_id": utterance_id,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "text": text
        }),
        BackendEvent::Error(message) => json!({
            "type": "capture_error",
            "message": message
        }),
        BackendEvent::Metric {
            name,
            utterance_id,
            at_ms,
        } => json!({
            "type": "pipeline_metric",
            "name": name,
            "utterance_id": utterance_id,
            "at_ms": at_ms
        }),
        BackendEvent::Stage(message) => json!({
            "type": "capture_stage",
            "message": message
        }),
    };

    println!("{value}");
}

fn ms_to_samples(ms: u64) -> u64 {
    ms * OUTPUT_SAMPLE_RATE_HZ as u64 / 1000
}

fn samples_to_ms(samples: u64) -> u64 {
    samples * 1000 / OUTPUT_SAMPLE_RATE_HZ as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_FRAME_MS: u64 = 30;

    fn test_frame(source: TranscriptSource, samples: Vec<f32>) -> AudioFrame {
        AudioFrame {
            source,
            sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
            channels: 1,
            samples,
        }
    }

    fn samples_for_ms(ms: u64, value: f32) -> Vec<f32> {
        vec![value; ms_to_samples(ms) as usize]
    }

    fn speech_frame() -> Vec<f32> {
        vec![0.05; VAD_FRAME_SAMPLES]
    }

    fn silence_frame() -> Vec<f32> {
        vec![0.0; VAD_FRAME_SAMPLES]
    }

    #[test]
    fn vad_closes_after_configured_silence() {
        let clock = PipelineClock::new();
        let mut detector = EndpointDetector::new(EndpointConfig::default());
        let mut utterances = Vec::new();

        for _ in 0..10 {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
        }

        assert!(utterances.is_empty());

        for _ in 0..(END_SILENCE_MS / TEST_FRAME_MS + 1) {
            utterances.extend(detector.push_samples(&silence_frame(), &clock));
        }

        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].endpoint_reason, EndpointReason::Silence);
        assert!(utterances[0].samples.len() >= ms_to_samples(MIN_SPEECH_MS) as usize);
    }

    #[test]
    fn vad_does_not_close_during_short_clause_pause() {
        let clock = PipelineClock::new();
        let mut detector = EndpointDetector::new(EndpointConfig::default());
        let mut utterances = Vec::new();

        for _ in 0..10 {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
        }

        for _ in 0..((END_SILENCE_MS / TEST_FRAME_MS) - 2) {
            utterances.extend(detector.push_samples(&silence_frame(), &clock));
        }

        for _ in 0..5 {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
        }

        assert!(utterances.is_empty());
        let flushed = detector
            .flush(&clock)
            .expect("active utterance should flush");
        assert_eq!(flushed.endpoint_reason, EndpointReason::Stop);
    }

    #[test]
    fn max_utterance_duration_forces_flush() {
        let clock = PipelineClock::new();
        let mut detector = EndpointDetector::new(EndpointConfig::default());
        let mut utterances = Vec::new();

        for _ in 0..(MAX_UTTERANCE_MS / TEST_FRAME_MS + 1) {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
            if !utterances.is_empty() {
                break;
            }
        }

        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].endpoint_reason, EndpointReason::MaxDuration);
    }

    #[test]
    fn silence_only_input_does_not_trigger_utterance() {
        let clock = PipelineClock::new();
        let mut detector = EndpointDetector::new(EndpointConfig::default());
        let mut utterances = Vec::new();

        for _ in 0..40 {
            utterances.extend(detector.push_samples(&silence_frame(), &clock));
        }

        assert!(utterances.is_empty());
        assert!(detector.flush(&clock).is_none());
    }

    #[test]
    fn source_pipeline_uses_same_endpoint_detector() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(clock, EndpointConfig::default());
        let mut segments = Vec::new();

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(600, 0.05),
            )),
        );
        assert!(segments.is_empty());

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(600, 0.0),
            )),
        );

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].endpoint_reason, EndpointReason::Silence);
        assert_eq!(segments[0].id, 1);
        assert!(segments[0].metrics.vad_speech_started_at_ms.is_some());
        assert!(segments[0].metrics.vad_endpoint_at_ms.is_some());
    }

    #[test]
    fn source_pipeline_emits_live_preview_before_endpoint() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(clock, EndpointConfig::default());
        let outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(900, 0.05),
        ));

        let previews = outputs
            .into_iter()
            .filter_map(|output| match output {
                PipelineOutput::Preview(preview) => Some(preview),
                PipelineOutput::Segment(_) => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0].id, 1);
        assert!(previews[0].end_ms >= LIVE_PARTIAL_MIN_MS);
    }

    #[test]
    fn source_pipeline_final_segment_reuses_preview_id() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(clock, EndpointConfig::default());
        let preview_id = pipeline
            .push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(900, 0.05),
            ))
            .into_iter()
            .find_map(|output| match output {
                PipelineOutput::Preview(preview) => Some(preview.id),
                PipelineOutput::Segment(_) => None,
            })
            .expect("preview should emit");
        let mut segments = Vec::new();

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(600, 0.0),
            )),
        );

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].id, preview_id);
    }

    #[test]
    fn stable_partial_text_only_emits_prefix_shared_by_adjacent_decodes() {
        let mut stability = HashMap::new();

        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::System,
                1,
                "The fervently of it is is is is is unique"
            ),
            Some("The fervently of it is is is is is unique".to_string())
        );
        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::System,
                1,
                "The fervently of it is is unique in the sense"
            ),
            None
        );
        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::System,
                1,
                "The fervently of it is is unique in the sense that"
            ),
            Some("The fervently of it is is unique in the sense".to_string())
        );
    }

    #[test]
    fn stable_partial_text_is_keyed_by_source_and_utterance() {
        let mut stability = HashMap::new();

        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::System,
                1,
                "speaker first guess"
            ),
            Some("speaker first guess".to_string())
        );
        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::Microphone,
                1,
                "microphone first guess"
            ),
            Some("microphone first guess".to_string())
        );
        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::System,
                1,
                "speaker first guess continues"
            ),
            None
        );
        assert_eq!(
            stable_partial_text(
                &mut stability,
                TranscriptSource::Microphone,
                1,
                "microphone first guess continues"
            ),
            None
        );
    }

    #[test]
    fn final_text_reuses_stable_partial_when_final_only_duplicates_last_word() {
        let stability = PartialStability {
            emitted_text: "it happened with like Vim and".to_string(),
            previous_raw_text: "it happened with like Vim and".to_string(),
        };

        assert_eq!(
            final_text_with_stable_partial(
                Some(stability),
                "it happened with like Vim and and".to_string()
            ),
            "it happened with like Vim and"
        );
    }

    #[test]
    fn transcript_repetition_suppression_collapses_pathological_short_token_runs() {
        assert_eq!(
            suppress_pathological_repetitions(
                "Which is what, a a a a a a a a a a a an academic uh Hoover institution is uh"
            ),
            "Which is what, a a an academic uh Hoover institution is uh"
        );
        assert_eq!(
            suppress_pathological_repetitions("I I I I I mean the the the answer"),
            "I I mean the the the answer"
        );
    }

    #[test]
    fn transcript_repetition_suppression_preserves_normal_repetition() {
        assert_eq!(
            suppress_pathological_repetitions("very very complicated question"),
            "very very complicated question"
        );
        assert_eq!(
            suppress_pathological_repetitions("had enough peace, so they invited me"),
            "had enough peace, so they invited me"
        );
        assert_eq!(
            suppress_pathological_repetitions("a a academic example"),
            "a a academic example"
        );
    }

    #[test]
    fn metric_timestamps_are_monotonic_for_endpointing() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(clock, EndpointConfig::default());
        let mut segments = Vec::new();

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(500, 0.05),
            )),
        );
        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(600, 0.0),
            )),
        );

        let segment = segments.first().expect("one utterance should close");
        let speech_started = segment
            .metrics
            .vad_speech_started_at_ms
            .expect("speech metric exists");
        let endpoint = segment
            .metrics
            .vad_endpoint_at_ms
            .expect("endpoint metric exists");
        let queued = segment
            .metrics
            .asr_queued_at_ms
            .expect("queued metric exists");

        assert!(speech_started <= endpoint);
        assert!(endpoint <= queued);
    }

    #[test]
    fn downmixes_stereo_and_resamples_to_target_rate() {
        let mut resampler = StreamResampler::new();
        let frame = AudioFrame {
            source: TranscriptSource::Microphone,
            sample_rate_hz: 32_000,
            channels: 2,
            samples: (0..64_000).flat_map(|_| [0.2, 0.6]).collect(),
        };

        let mut output = resampler.push(&frame);
        output.extend(resampler.finish());

        assert!(!output.is_empty());
        assert!(output.iter().all(|sample| sample.is_finite()));
        let mean = output.iter().sum::<f32>() / output.len() as f32;
        assert!((mean - 0.4).abs() < 0.02);
    }
}
