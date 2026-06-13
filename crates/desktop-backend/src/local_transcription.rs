use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
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
const DEFAULT_PRE_ROLL_MS: u64 = 200;
const DEFAULT_MIN_SPEECH_MS: u64 = 250;
const DEFAULT_END_SILENCE_MS: u64 = 450;
const DEFAULT_MAX_UTTERANCE_MS: u64 = 8_000;
const DEFAULT_ENERGY_SPEECH_THRESHOLD: f32 = 0.004;
const DEFAULT_HOT_CAPTURE_PRE_ROLL_MS: u64 = 500;
const DIRECT_WAV_SINGLE_MAX_MS: u64 = 30_000;
const DIRECT_WAV_CHUNK_MS: u64 = 30_000;
const DIRECT_WAV_CHUNK_OVERLAP_MS: u64 = 2_000;
const STITCH_BOUNDARY_WORDS: usize = 80;
const STITCH_LCS_EDGE_WORDS: usize = 5;
const STITCH_MIN_OVERLAP_WORDS: usize = 4;
const STITCH_MIN_OVERLAP_CHARS: usize = 18;
const DEFAULT_LIVE_PARTIAL_FIRST_MS: u64 = 1_500;
const DEFAULT_LIVE_PARTIAL_INTERVAL_MS: u64 = 1_500;

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

#[derive(Clone, Debug)]
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
struct SpeechPartialSnapshot {
    source: TranscriptSource,
    utterance_id: u64,
    start_ms: u64,
    end_ms: u64,
    revision: u64,
    queued_at_ms: u64,
    samples: Vec<f32>,
}

#[derive(Debug)]
enum BackendEvent {
    SpeechStarted {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
    },
    Completed {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
        end_ms: u64,
        text: String,
    },
    Partial {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
        end_ms: u64,
        revision: u64,
        text: String,
    },
    Error(String),
    Metric {
        name: &'static str,
        utterance_id: Option<u64>,
        at_ms: u64,
        value: Option<u64>,
    },
    Stage(String),
}

enum TranscriptionJob {
    Warmup,
    SpeechStarted {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
    },
    Segment(SpeechSegment),
    PartialSnapshot(SpeechPartialSnapshot),
    Barrier(Sender<()>),
    Stop,
}

#[derive(Clone, Default)]
struct AsrQueueMetrics {
    active_jobs: Arc<Mutex<u64>>,
    queued_at_ms: Arc<Mutex<VecDeque<u64>>>,
}

impl AsrQueueMetrics {
    fn record_queued(
        &self,
        queued_at_ms: u64,
        event_tx: &Sender<BackendEvent>,
        clock: &PipelineClock,
    ) {
        if let Ok(mut queue) = self.queued_at_ms.lock() {
            queue.push_back(queued_at_ms);
        }
        self.emit(event_tx, clock);
    }

    fn record_started(&self, event_tx: &Sender<BackendEvent>, clock: &PipelineClock) {
        if let Ok(mut queue) = self.queued_at_ms.lock() {
            let _ = queue.pop_front();
        }
        if let Ok(mut active_jobs) = self.active_jobs.lock() {
            *active_jobs = active_jobs.saturating_add(1);
        }
        self.emit(event_tx, clock);
    }

    fn record_completed(&self, event_tx: &Sender<BackendEvent>, clock: &PipelineClock) {
        if let Ok(mut active_jobs) = self.active_jobs.lock() {
            *active_jobs = active_jobs.saturating_sub(1);
        }
        self.emit(event_tx, clock);
    }

    fn snapshot(&self, clock: &PipelineClock) -> AsrQueueSnapshot {
        let Ok(queue) = self.queued_at_ms.lock() else {
            return AsrQueueSnapshot {
                active_jobs: 0,
                depth: 0,
                oldest_age_ms: 0,
            };
        };
        let now = clock.elapsed_ms();
        let oldest_age_ms = queue
            .front()
            .map(|queued_at_ms| now.saturating_sub(*queued_at_ms))
            .unwrap_or(0);

        AsrQueueSnapshot {
            active_jobs: self.active_jobs.lock().map(|value| *value).unwrap_or(0),
            depth: queue.len() as u64,
            oldest_age_ms,
        }
    }

    fn emit(&self, event_tx: &Sender<BackendEvent>, clock: &PipelineClock) {
        if !pipeline_metrics_enabled() {
            return;
        }

        let snapshot = self.snapshot(clock);
        let at_ms = clock.elapsed_ms();
        let _ = event_tx.send(BackendEvent::Metric {
            name: "asr_queue_depth",
            utterance_id: None,
            at_ms,
            value: Some(snapshot.depth),
        });
        let _ = event_tx.send(BackendEvent::Metric {
            name: "asr_queue_oldest_age_ms",
            utterance_id: None,
            at_ms,
            value: Some(snapshot.oldest_age_ms),
        });
    }

    fn can_enqueue_partial(&self) -> bool {
        let snapshot = self.snapshot_without_clock();
        snapshot.depth == 0 && snapshot.active_jobs == 0
    }

    fn snapshot_without_clock(&self) -> AsrQueueSnapshot {
        let Ok(queue) = self.queued_at_ms.lock() else {
            return AsrQueueSnapshot {
                active_jobs: 0,
                depth: 0,
                oldest_age_ms: 0,
            };
        };

        AsrQueueSnapshot {
            depth: queue.len() as u64,
            oldest_age_ms: 0,
            active_jobs: self.active_jobs.lock().map(|value| *value).unwrap_or(0),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct AsrQueueSnapshot {
    active_jobs: u64,
    depth: u64,
    oldest_age_ms: u64,
}

enum DaemonCommand {
    Prepare {
        sources: Vec<TranscriptSource>,
        hot_capture: bool,
    },
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
    let queue_metrics = AsrQueueMetrics::default();
    let transcription_events = event_tx.clone();
    let transcription_clock = clock.clone();
    let transcription_queue_metrics = queue_metrics.clone();
    let transcription_thread = thread::spawn(move || {
        run_transcription_worker(
            job_rx,
            transcription_events,
            transcription_clock,
            transcription_queue_metrics,
        );
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
    let mut batchers = sources
        .iter()
        .copied()
        .map(|source| {
            (
                source,
                SourcePipeline::new(source, clock.clone(), endpoint_config),
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
                value: None,
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
                        value: None,
                    });
                }

                if let Some(batcher) = batchers.get_mut(&frame.source) {
                    for output in batcher.push_frame(frame) {
                        send_pipeline_output(&job_tx, output, &queue_metrics, &event_tx, &clock);
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
            enqueue_segment_job(&job_tx, segment, &queue_metrics, &event_tx, &clock);
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
    let queue_metrics = AsrQueueMetrics::default();
    let transcription_events = event_tx.clone();
    let transcription_clock = clock.clone();
    let transcription_queue_metrics = queue_metrics.clone();
    let transcription_thread = thread::spawn(move || {
        run_transcription_worker(
            job_rx,
            transcription_events,
            transcription_clock,
            transcription_queue_metrics,
        );
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
                DaemonCommand::Prepare {
                    sources,
                    hot_capture,
                } => {
                    if !sources.is_empty() {
                        let _ = job_tx.send(TranscriptionJob::Warmup);
                        prepare_local_transcription_model(&event_tx)?;

                        if hot_capture {
                            start_or_prepare_session(
                                &mut session,
                                sources,
                                &clock,
                                &audio_tx,
                                &event_tx,
                                &job_tx,
                                &queue_metrics,
                            )?;
                        }
                    }
                }
                DaemonCommand::Start { sources } => {
                    if sources.is_empty() {
                        event_tx.send(BackendEvent::Error(
                            "Select at least one audio source.".to_string(),
                        ))?;
                    } else {
                        drain_or_buffer_audio_frames(&audio_rx, session.as_mut());
                        start_or_activate_session(
                            &mut session,
                            sources,
                            &clock,
                            &audio_tx,
                            &event_tx,
                            &job_tx,
                            &queue_metrics,
                        )?;
                    }
                }
                DaemonCommand::Stop => {
                    stop_active_session(&mut session, &job_tx, &event_tx, &queue_metrics, &clock);
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
                        active_session.buffer_preroll_frame(frame);
                        continue;
                    }

                    if emit_pipeline_metrics && !active_session.saw_audio {
                        active_session.saw_audio = true;
                        let _ = event_tx.send(BackendEvent::Metric {
                            name: "audio_started_at",
                            utterance_id: None,
                            at_ms: clock.elapsed_ms(),
                            value: None,
                        });
                    }

                    if let Some(batcher) = active_session.batchers.get_mut(&frame.source) {
                        for output in batcher.push_frame(frame) {
                            send_pipeline_output(&job_tx, output, &queue_metrics, &event_tx, &clock);
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        drain_events(&event_rx);
    }

    stop_active_session(&mut session, &job_tx, &event_tx, &queue_metrics, &clock);
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
    preroll_frames: VecDeque<AudioFrame>,
    preroll_ms: u64,
    max_preroll_ms: u64,
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
    let batchers = sources
        .iter()
        .copied()
        .map(|source| {
            (
                source,
                SourcePipeline::new(source, clock.clone(), endpoint_config),
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
        preroll_frames: VecDeque::new(),
        preroll_ms: 0,
        max_preroll_ms: hot_capture_preroll_ms(),
    })
}

fn start_or_prepare_session(
    session: &mut Option<ActiveSession>,
    sources: Vec<TranscriptSource>,
    clock: &PipelineClock,
    audio_tx: &Sender<AudioFrame>,
    event_tx: &Sender<BackendEvent>,
    job_tx: &Sender<TranscriptionJob>,
    queue_metrics: &AsrQueueMetrics,
) -> Result<(), Box<dyn std::error::Error>> {
    let can_reuse = session
        .as_ref()
        .is_some_and(|active_session| active_session.sources == sources);

    if !can_reuse {
        stop_active_session(session, job_tx, event_tx, queue_metrics, clock);
        *session = Some(start_active_session(
            sources, clock, audio_tx, event_tx, false,
        )?);
    }

    if let Some(active_session) = session.as_mut() {
        active_session.accepting_audio = false;
        active_session.saw_audio = false;
        active_session.reset_batchers(clock);
        active_session.clear_preroll();
        event_tx.send(BackendEvent::Stage(
            "local Parakeet hot capture armed".to_string(),
        ))?;
    }

    Ok(())
}

fn start_or_activate_session(
    session: &mut Option<ActiveSession>,
    sources: Vec<TranscriptSource>,
    clock: &PipelineClock,
    audio_tx: &Sender<AudioFrame>,
    event_tx: &Sender<BackendEvent>,
    job_tx: &Sender<TranscriptionJob>,
    queue_metrics: &AsrQueueMetrics,
) -> Result<(), Box<dyn std::error::Error>> {
    let can_reuse = session
        .as_ref()
        .is_some_and(|active_session| active_session.sources == sources);

    if !can_reuse {
        stop_active_session(session, job_tx, event_tx, queue_metrics, clock);
        *session = Some(start_active_session(
            sources, clock, audio_tx, event_tx, true,
        )?);
        return Ok(());
    }

    if let Some(active_session) = session.as_mut() {
        active_session.accepting_audio = true;
        active_session.saw_audio = false;
        active_session.reset_batchers(clock);
        active_session.drain_preroll(job_tx, queue_metrics, event_tx, clock);
        event_tx.send(BackendEvent::Stage(
            "local Parakeet capture started".to_string(),
        ))?;
    }

    Ok(())
}

fn drain_or_buffer_audio_frames(
    receiver: &mpsc::Receiver<AudioFrame>,
    session: Option<&mut ActiveSession>,
) {
    let mut session = session;

    while let Ok(frame) = receiver.try_recv() {
        if let Some(active_session) = session.as_deref_mut() {
            if !active_session.accepting_audio {
                active_session.buffer_preroll_frame(frame);
            }
        }
    }
}

fn prepare_local_transcription_model(
    event_tx: &Sender<BackendEvent>,
) -> Result<(), Box<dyn std::error::Error>> {
    event_tx.send(BackendEvent::Stage(
        "local Parakeet model prepared".to_string(),
    ))?;

    Ok(())
}

impl ActiveSession {
    fn buffer_preroll_frame(&mut self, frame: AudioFrame) {
        if self.max_preroll_ms == 0 || !self.sources.contains(&frame.source) {
            return;
        }

        self.preroll_ms = self.preroll_ms.saturating_add(frame_duration_ms(&frame));
        self.preroll_frames.push_back(frame);

        while self.preroll_ms > self.max_preroll_ms {
            let Some(removed) = self.preroll_frames.pop_front() else {
                self.preroll_ms = 0;
                break;
            };

            self.preroll_ms = self.preroll_ms.saturating_sub(frame_duration_ms(&removed));
        }
    }

    fn drain_preroll(
        &mut self,
        job_tx: &Sender<TranscriptionJob>,
        queue_metrics: &AsrQueueMetrics,
        event_tx: &Sender<BackendEvent>,
        clock: &PipelineClock,
    ) {
        while let Some(frame) = self.preroll_frames.pop_front() {
            if let Some(batcher) = self.batchers.get_mut(&frame.source) {
                for output in batcher.push_frame(frame) {
                    send_pipeline_output(job_tx, output, queue_metrics, event_tx, clock);
                }
            }
        }

        self.preroll_ms = 0;
    }

    fn clear_preroll(&mut self) {
        self.preroll_frames.clear();
        self.preroll_ms = 0;
    }

    fn reset_batchers(&mut self, clock: &PipelineClock) {
        let endpoint_config = EndpointConfig::from_environment();
        self.batchers = self
            .sources
            .iter()
            .copied()
            .map(|source| {
                (
                    source,
                    SourcePipeline::new(source, clock.clone(), endpoint_config),
                )
            })
            .collect::<HashMap<_, _>>();
    }
}

fn frame_duration_ms(frame: &AudioFrame) -> u64 {
    if frame.sample_rate_hz == 0 || frame.channels == 0 {
        return 0;
    }

    let frames = frame.samples.len() as u64 / frame.channels as u64;

    frames * 1000 / frame.sample_rate_hz as u64
}

fn hot_capture_preroll_ms() -> u64 {
    env_u64("CAUL_HOT_CAPTURE_PRE_ROLL_MS").unwrap_or(DEFAULT_HOT_CAPTURE_PRE_ROLL_MS)
}

fn live_partials_enabled() -> bool {
    std::env::var("CAUL_LIVE_PARTIALS")
        .map(|value| value != "0")
        .unwrap_or(true)
}

fn live_partial_first_ms() -> u64 {
    env_u64("CAUL_LIVE_PARTIAL_FIRST_MS").unwrap_or(DEFAULT_LIVE_PARTIAL_FIRST_MS)
}

fn live_partial_interval_ms() -> u64 {
    env_u64("CAUL_LIVE_PARTIAL_INTERVAL_MS").unwrap_or(DEFAULT_LIVE_PARTIAL_INTERVAL_MS)
}

fn stop_active_session(
    session: &mut Option<ActiveSession>,
    job_tx: &Sender<TranscriptionJob>,
    event_tx: &Sender<BackendEvent>,
    queue_metrics: &AsrQueueMetrics,
    clock: &PipelineClock,
) {
    let Some(mut active_session) = session.take() else {
        return;
    };

    active_session.running.store(false, Ordering::SeqCst);
    drop(active_session._microphone_capture.take());

    for batcher in active_session.batchers.values_mut() {
        if let Some(segment) = batcher.flush() {
            enqueue_segment_job(job_tx, segment, queue_metrics, event_tx, clock);
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

fn send_pipeline_output(
    job_tx: &Sender<TranscriptionJob>,
    output: PipelineOutput,
    queue_metrics: &AsrQueueMetrics,
    event_tx: &Sender<BackendEvent>,
    clock: &PipelineClock,
) {
    match output {
        PipelineOutput::SpeechStarted {
            source,
            utterance_id,
            start_ms,
        } => {
            let _ = job_tx.send(TranscriptionJob::SpeechStarted {
                source,
                utterance_id,
                start_ms,
            });
        }
        PipelineOutput::Segment(segment) => {
            enqueue_segment_job(job_tx, segment, queue_metrics, event_tx, clock);
        }
        PipelineOutput::PartialSnapshot(snapshot) => {
            enqueue_partial_snapshot_job(job_tx, snapshot, queue_metrics, event_tx, clock);
        }
    }
}

fn enqueue_segment_job(
    job_tx: &Sender<TranscriptionJob>,
    segment: SpeechSegment,
    queue_metrics: &AsrQueueMetrics,
    event_tx: &Sender<BackendEvent>,
    clock: &PipelineClock,
) {
    queue_metrics.record_queued(
        segment
            .metrics
            .asr_queued_at_ms
            .unwrap_or_else(|| clock.elapsed_ms()),
        event_tx,
        clock,
    );
    let _ = job_tx.send(TranscriptionJob::Segment(segment));
}

fn enqueue_partial_snapshot_job(
    job_tx: &Sender<TranscriptionJob>,
    snapshot: SpeechPartialSnapshot,
    queue_metrics: &AsrQueueMetrics,
    event_tx: &Sender<BackendEvent>,
    clock: &PipelineClock,
) {
    if !queue_metrics.can_enqueue_partial() {
        return;
    }

    queue_metrics.record_queued(snapshot.queued_at_ms, event_tx, clock);
    let _ = job_tx.send(TranscriptionJob::PartialSnapshot(snapshot));
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
            let hot_capture = value
                .get("hotCapture")
                .or_else(|| value.get("hot_capture"))
                .and_then(Value::as_bool)
                .unwrap_or(false);

            Some(DaemonCommand::Prepare {
                sources,
                hot_capture,
            })
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
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::from_environment(),
        );
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

pub fn run_long_transcription_soak_fixture() -> Result<(), Box<dyn std::error::Error>> {
    let clock = PipelineClock::new();
    let mut pipeline = SourcePipeline::new(
        TranscriptSource::System,
        clock,
        EndpointConfig::default(),
    );
    let target_ms = 60 * 60 * 1000;
    let frames = target_ms / VAD_FRAME_MS;
    let mut segment_count = 0_u64;
    let mut max_segment_ms = 0_u64;
    let mut previous_end_ms = 0_u64;
    let mut ordered = true;
    let mut bounded = true;
    let max_allowed_ms = DEFAULT_MAX_UTTERANCE_MS + VAD_FRAME_MS;

    for _ in 0..frames {
        for output in pipeline.push_frame(AudioFrame {
            source: TranscriptSource::System,
            sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
            channels: 1,
            samples: speech_frame_samples(),
        }) {
            if let PipelineOutput::Segment(segment) = output {
                let segment_ms = segment.end_ms.saturating_sub(segment.start_ms);
                segment_count += 1;
                max_segment_ms = max_segment_ms.max(segment_ms);
                ordered = ordered && segment.start_ms >= previous_end_ms;
                previous_end_ms = segment.end_ms;
                bounded = bounded && segment_ms <= max_allowed_ms;
            }
        }
    }

    if let Some(segment) = pipeline.flush() {
        let segment_ms = segment.end_ms.saturating_sub(segment.start_ms);
        segment_count += 1;
        max_segment_ms = max_segment_ms.max(segment_ms);
        ordered = ordered && segment.start_ms >= previous_end_ms;
        previous_end_ms = segment.end_ms;
        bounded = bounded && segment_ms <= max_allowed_ms;
    }

    let ok = segment_count > 0 && bounded && ordered;
    println!(
        "{}",
        json!({
            "type": "long_transcription_soak_summary",
            "ok": ok,
            "duration_ms": target_ms,
            "segment_count": segment_count,
            "max_segment_ms": max_segment_ms,
            "max_allowed_segment_ms": max_allowed_ms,
            "ordered": ordered,
            "bounded": bounded,
            "final_end_ms": previous_end_ms
        })
    );

    if ok {
        Ok(())
    } else {
        Err("long transcription soak fixture failed".into())
    }
}

fn collect_segments_into(segments: &mut Vec<SpeechSegment>, outputs: Vec<PipelineOutput>) {
    segments.extend(outputs.into_iter().filter_map(|output| match output {
        PipelineOutput::Segment(segment) => Some(segment),
        PipelineOutput::PartialSnapshot(_) | PipelineOutput::SpeechStarted { .. } => None,
    }));
}

pub fn run_parakeet_wav_benchmark(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let clock = PipelineClock::new();
    let audio_read_started_at_ms = clock.elapsed_ms();
    let samples = read_mono_16khz_wav(path)?;
    let audio_read_completed_at_ms = clock.elapsed_ms();
    let audio_duration_ms = samples_to_ms(samples.len() as u64);
    let sample_windows = direct_wav_sample_windows(samples.len());

    let model_load_started_at_ms = clock.elapsed_ms();
    let model_dir = ensure_parakeet_model()?;
    let mut model = ParakeetModel::load(&model_dir, &Quantization::Int8)?;
    let model_load_completed_at_ms = clock.elapsed_ms();

    let asr_started_at_ms = clock.elapsed_ms();
    let mut chunk_summaries = Vec::new();
    let mut asr_ms_total = 0;

    for window in &sample_windows {
        let chunk_started_at_ms = clock.elapsed_ms();
        let result = transcribe_parakeet_sample_window(&mut model, &samples[window.range()])?;
        let chunk_completed_at_ms = clock.elapsed_ms();
        let chunk_asr_ms = chunk_completed_at_ms.saturating_sub(chunk_started_at_ms);
        let text = result.text.trim().to_string();
        asr_ms_total += chunk_asr_ms;

        chunk_summaries.push(DirectWavChunkSummary {
            index: window.index,
            start_ms: samples_to_ms(window.start_sample as u64),
            end_ms: samples_to_ms(window.end_sample as u64),
            audio_duration_ms: samples_to_ms(window.len() as u64),
            samples: window.len(),
            asr_ms: chunk_asr_ms,
            transcript: text,
        });
    }

    let asr_completed_at_ms = clock.elapsed_ms();
    let stitched_transcript = stitch_direct_wav_chunks(&chunk_summaries);
    let stats = audio_stats(&samples);
    let mode = if sample_windows.len() == 1 {
        "single"
    } else {
        "chunked"
    };
    let max_chunk_duration_ms = sample_windows
        .iter()
        .map(|window| samples_to_ms(window.len() as u64))
        .max()
        .unwrap_or(0);
    let chunk_json: Vec<Value> = chunk_summaries
        .iter()
        .zip(stitched_transcript.chunks.iter())
        .map(|(chunk, stitched)| {
            json!({
                "index": chunk.index,
                "start_ms": chunk.start_ms,
                "end_ms": chunk.end_ms,
                "audio_duration_ms": chunk.audio_duration_ms,
                "samples": chunk.samples,
                "asr_ms": chunk.asr_ms,
                "transcript_chars": chunk.transcript.len(),
                "transcript": chunk.transcript,
                "stitched_transcript_chars": stitched.transcript.len(),
                "stitched_transcript": stitched.transcript,
                "merge_strategy": stitched.strategy.as_str(),
                "overlap_words": stitched.overlap_words,
                "dropped_prefix_words": stitched.dropped_prefix_words,
                "dropped_previous_suffix_words": stitched.dropped_previous_suffix_words
            })
        })
        .collect();

    println!(
        "{}",
        json!({
            "type": "parakeet_direct_bench",
            "mode": mode,
            "path": path.display().to_string(),
            "sample_rate_hz": OUTPUT_SAMPLE_RATE_HZ,
            "samples": samples.len(),
            "audio_duration_ms": audio_duration_ms,
            "chunk_count": sample_windows.len(),
            "chunk_ms": DIRECT_WAV_CHUNK_MS,
            "chunk_overlap_ms": DIRECT_WAV_CHUNK_OVERLAP_MS,
            "max_chunk_duration_ms": max_chunk_duration_ms,
            "chunks": chunk_json,
            "stitched": sample_windows.len() > 1,
            "audio_read_started_at_ms": audio_read_started_at_ms,
            "audio_read_completed_at_ms": audio_read_completed_at_ms,
            "model_load_started_at_ms": model_load_started_at_ms,
            "model_load_completed_at_ms": model_load_completed_at_ms,
            "asr_started_at_ms": asr_started_at_ms,
            "asr_completed_at_ms": asr_completed_at_ms,
            "audio_read_ms": audio_read_completed_at_ms.saturating_sub(audio_read_started_at_ms),
            "model_load_ms": model_load_completed_at_ms.saturating_sub(model_load_started_at_ms),
            "asr_ms": asr_completed_at_ms.saturating_sub(asr_started_at_ms),
            "asr_chunk_ms_total": asr_ms_total,
            "rms": stats.rms,
            "peak": stats.peak,
            "raw_transcript": stitched_transcript.raw_transcript,
            "transcript": stitched_transcript.transcript
        })
    );

    Ok(())
}

fn transcribe_parakeet_sample_window(
    model: &mut ParakeetModel,
    samples: &[f32],
) -> Result<transcribe_rs::TranscriptionResult, transcribe_rs::TranscribeError> {
    let params = ParakeetParams {
        timestamp_granularity: Some(TimestampGranularity::Segment),
        ..Default::default()
    };
    model.transcribe_with(samples, &params)
}

fn direct_wav_sample_windows(total_samples: usize) -> Vec<SampleWindow> {
    let chunk_samples = ms_to_samples(DIRECT_WAV_CHUNK_MS) as usize;
    let overlap_samples = ms_to_samples(DIRECT_WAV_CHUNK_OVERLAP_MS) as usize;
    let single_max_samples = ms_to_samples(DIRECT_WAV_SINGLE_MAX_MS) as usize;

    if total_samples <= single_max_samples {
        segment_sample_windows(total_samples, total_samples.max(1), 0)
    } else {
        segment_sample_windows(total_samples, chunk_samples, overlap_samples)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SampleWindow {
    index: usize,
    start_sample: usize,
    end_sample: usize,
}

impl SampleWindow {
    fn len(&self) -> usize {
        self.end_sample.saturating_sub(self.start_sample)
    }

    fn range(&self) -> std::ops::Range<usize> {
        self.start_sample..self.end_sample
    }
}

fn segment_sample_windows(
    total_samples: usize,
    chunk_samples: usize,
    overlap_samples: usize,
) -> Vec<SampleWindow> {
    if total_samples == 0 || chunk_samples == 0 {
        return Vec::new();
    }

    if total_samples <= chunk_samples {
        return vec![SampleWindow {
            index: 0,
            start_sample: 0,
            end_sample: total_samples,
        }];
    }

    let step_samples = chunk_samples.saturating_sub(overlap_samples).max(1);
    let mut windows = Vec::new();
    let mut start_sample = 0;

    loop {
        let end_sample = (start_sample + chunk_samples).min(total_samples);
        windows.push(SampleWindow {
            index: windows.len(),
            start_sample,
            end_sample,
        });

        if end_sample >= total_samples {
            break;
        }

        start_sample += step_samples;
    }

    windows
}

#[derive(Clone, Debug)]
struct DirectWavChunkSummary {
    index: usize,
    start_ms: u64,
    end_ms: u64,
    audio_duration_ms: u64,
    samples: usize,
    asr_ms: u64,
    transcript: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StitchedTranscript {
    transcript: String,
    raw_transcript: String,
    chunks: Vec<StitchedChunk>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StitchedChunk {
    transcript: String,
    strategy: StitchStrategy,
    overlap_words: usize,
    dropped_prefix_words: usize,
    dropped_previous_suffix_words: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StitchStrategy {
    Exact,
    Lcs,
    Append,
}

impl StitchStrategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Lcs => "lcs",
            Self::Append => "append",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct WordToken {
    original: String,
    normalised: String,
}

fn stitch_direct_wav_chunks(chunks: &[DirectWavChunkSummary]) -> StitchedTranscript {
    let raw_transcript = chunks
        .iter()
        .map(|chunk| chunk.transcript.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let mut stitched_lines = Vec::new();
    let mut stitched_tokens = Vec::new();
    let mut stitched_chunks = Vec::new();

    for chunk in chunks {
        let text = chunk.transcript.trim();
        let tokens = word_tokens(text);

        if text.is_empty() || tokens.is_empty() {
            stitched_chunks.push(StitchedChunk {
                transcript: String::new(),
                strategy: StitchStrategy::Append,
                overlap_words: 0,
                dropped_prefix_words: 0,
                dropped_previous_suffix_words: 0,
            });
            continue;
        }

        let decision = if stitched_tokens.is_empty() {
            StitchDecision {
                strategy: StitchStrategy::Append,
                overlap_words: 0,
                dropped_prefix_words: 0,
                dropped_previous_suffix_words: 0,
            }
        } else {
            detect_chunk_overlap(&stitched_tokens, &tokens)
        };

        if decision.dropped_previous_suffix_words > 0 {
            drop_stitched_suffix(
                &mut stitched_lines,
                &mut stitched_tokens,
                decision.dropped_previous_suffix_words,
            );
        }

        let emitted = tokens
            .iter()
            .skip(decision.dropped_prefix_words)
            .map(|token| token.original.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();

        if !emitted.is_empty() {
            stitched_tokens.extend(word_tokens(&emitted));
            stitched_lines.push(emitted.clone());
        }

        stitched_chunks.push(StitchedChunk {
            transcript: emitted,
            strategy: decision.strategy,
            overlap_words: decision.overlap_words,
            dropped_prefix_words: decision.dropped_prefix_words,
            dropped_previous_suffix_words: decision.dropped_previous_suffix_words,
        });
    }

    StitchedTranscript {
        transcript: stitched_lines.join("\n").trim().to_string(),
        raw_transcript,
        chunks: stitched_chunks,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StitchDecision {
    strategy: StitchStrategy,
    overlap_words: usize,
    dropped_prefix_words: usize,
    dropped_previous_suffix_words: usize,
}

fn detect_chunk_overlap(previous: &[WordToken], next: &[WordToken]) -> StitchDecision {
    if previous.is_empty() || next.is_empty() {
        return append_stitch_decision();
    }

    if let Some(words) = detect_exact_suffix_prefix_overlap(previous, next) {
        return StitchDecision {
            strategy: StitchStrategy::Exact,
            overlap_words: words,
            dropped_prefix_words: words,
            dropped_previous_suffix_words: 0,
        };
    }

    if let Some((overlap_words, dropped_previous_suffix_words)) =
        detect_prefix_inside_previous_tail_overlap(previous, next)
    {
        return StitchDecision {
            strategy: StitchStrategy::Lcs,
            overlap_words,
            dropped_prefix_words: 0,
            dropped_previous_suffix_words,
        };
    }

    if let Some((overlap_words, dropped_prefix_words)) = detect_lcs_boundary_overlap(previous, next)
    {
        return StitchDecision {
            strategy: StitchStrategy::Lcs,
            overlap_words,
            dropped_prefix_words,
            dropped_previous_suffix_words: 0,
        };
    }

    append_stitch_decision()
}

fn append_stitch_decision() -> StitchDecision {
    StitchDecision {
        strategy: StitchStrategy::Append,
        overlap_words: 0,
        dropped_prefix_words: 0,
        dropped_previous_suffix_words: 0,
    }
}

fn detect_exact_suffix_prefix_overlap(previous: &[WordToken], next: &[WordToken]) -> Option<usize> {
    let max_words = previous
        .len()
        .min(next.len())
        .min(STITCH_BOUNDARY_WORDS);

    for words in (1..=max_words).rev() {
        let previous_start = previous.len() - words;
        let previous_suffix = &previous[previous_start..];
        let next_prefix = &next[..words];

        if token_slices_match(previous_suffix, next_prefix) && overlap_is_confident(next_prefix) {
            return Some(words);
        }
    }

    None
}

fn detect_prefix_inside_previous_tail_overlap(
    previous: &[WordToken],
    next: &[WordToken],
) -> Option<(usize, usize)> {
    let previous_tail_start = previous.len().saturating_sub(STITCH_BOUNDARY_WORDS);
    let max_words = next.len().min(STITCH_BOUNDARY_WORDS);

    for words in (1..=max_words).rev() {
        let next_prefix = &next[..words];

        if !overlap_is_confident(next_prefix) {
            continue;
        }

        for previous_start in previous_tail_start..previous.len() {
            let previous_end = previous_start + words;

            if previous_end > previous.len() {
                break;
            }

            if previous_start < STITCH_LCS_EDGE_WORDS {
                continue;
            }

            let previous_suffix_after_match = previous.len().saturating_sub(previous_end);

            if previous_suffix_after_match > STITCH_LCS_EDGE_WORDS * 2 {
                continue;
            }

            if token_slices_match(&previous[previous_start..previous_end], next_prefix) {
                return Some((words, previous.len().saturating_sub(previous_start)));
            }
        }
    }

    None
}

fn detect_lcs_boundary_overlap(
    previous: &[WordToken],
    next: &[WordToken],
) -> Option<(usize, usize)> {
    let previous_start = previous.len().saturating_sub(STITCH_BOUNDARY_WORDS);
    let previous_band = &previous[previous_start..];
    let next_band_len = next.len().min(STITCH_BOUNDARY_WORDS);
    let next_band = &next[..next_band_len];
    let pairs = lcs_token_pairs(previous_band, next_band);

    if pairs.is_empty() {
        return None;
    }

    let first_next = pairs.first().map(|(_, next_index)| *next_index)?;
    let last_next = pairs.last().map(|(_, next_index)| *next_index)?;
    let last_previous = pairs.last().map(|(previous_index, _)| *previous_index)?;
    let matched_next_tokens = pairs
        .iter()
        .map(|(_, next_index)| next_band[*next_index].clone())
        .collect::<Vec<_>>();
    let dropped_prefix_words = last_next + 1;

    if first_next >= STITCH_LCS_EDGE_WORDS
        || last_previous + STITCH_LCS_EDGE_WORDS < previous_band.len()
        || dropped_prefix_words > pairs.len() + STITCH_LCS_EDGE_WORDS
        || !overlap_is_confident(&matched_next_tokens)
    {
        return None;
    }

    Some((pairs.len(), dropped_prefix_words))
}

fn lcs_token_pairs(left: &[WordToken], right: &[WordToken]) -> Vec<(usize, usize)> {
    if left.is_empty() || right.is_empty() {
        return Vec::new();
    }

    let mut lengths = vec![vec![0usize; right.len() + 1]; left.len() + 1];

    for left_index in 0..left.len() {
        for right_index in 0..right.len() {
            lengths[left_index + 1][right_index + 1] =
                if left[left_index].normalised == right[right_index].normalised {
                    lengths[left_index][right_index] + 1
                } else {
                    lengths[left_index + 1][right_index].max(lengths[left_index][right_index + 1])
                };
        }
    }

    let mut left_index = left.len();
    let mut right_index = right.len();
    let mut pairs = Vec::new();

    while left_index > 0 && right_index > 0 {
        if left[left_index - 1].normalised == right[right_index - 1].normalised {
            pairs.push((left_index - 1, right_index - 1));
            left_index -= 1;
            right_index -= 1;
        } else if lengths[left_index][right_index - 1] >= lengths[left_index - 1][right_index] {
            right_index -= 1;
        } else {
            left_index -= 1;
        }
    }

    pairs.reverse();
    pairs
}

fn drop_stitched_suffix(
    stitched_lines: &mut Vec<String>,
    stitched_tokens: &mut Vec<WordToken>,
    words_to_drop: usize,
) {
    if words_to_drop == 0 {
        return;
    }

    let keep_tokens = stitched_tokens.len().saturating_sub(words_to_drop);
    stitched_tokens.truncate(keep_tokens);

    let mut remaining_words = words_to_drop;

    while remaining_words > 0 {
        let Some(last_line) = stitched_lines.last_mut() else {
            break;
        };
        let line_tokens = word_tokens(last_line);

        if line_tokens.len() <= remaining_words {
            remaining_words -= line_tokens.len();
            stitched_lines.pop();
            continue;
        }

        let keep_words = line_tokens.len() - remaining_words;
        *last_line = line_tokens[..keep_words]
            .iter()
            .map(|token| token.original.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        remaining_words = 0;
    }
}

fn token_slices_match(left: &[WordToken], right: &[WordToken]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right.iter())
            .all(|(left, right)| left.normalised == right.normalised)
}

fn overlap_is_confident(tokens: &[WordToken]) -> bool {
    tokens.len() >= STITCH_MIN_OVERLAP_WORDS
        || tokens
            .iter()
            .map(|token| token.normalised.chars().count())
            .sum::<usize>()
            >= STITCH_MIN_OVERLAP_CHARS
}

fn word_tokens(text: &str) -> Vec<WordToken> {
    text.split_whitespace()
        .filter_map(|word| {
            let normalised = normalise_word(word);

            if normalised.is_empty() {
                None
            } else {
                Some(WordToken {
                    original: word.to_string(),
                    normalised,
                })
            }
        })
        .collect()
}

fn normalise_word(word: &str) -> String {
    let mut normalised = String::new();

    for character in word.chars() {
        for lower in character.to_lowercase() {
            if lower.is_alphanumeric() {
                normalised.push(lower);
            }
        }
    }

    normalised
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
        let Ok((mut capture, receiver)) = RunningSystemAudio::start(repository_root, false) else {
            let _ = event_tx.send(BackendEvent::Error(
                "System audio capture is currently unavailable.".to_string(),
            ));
            return;
        };

        while running.load(Ordering::SeqCst) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(SystemAudioUpdate::Started { .. }) => {
                    let _ = event_tx.send(BackendEvent::Stage(system_audio_started_stage()));
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
        match std::env::var("CAUL_MACOS_SYSTEM_AUDIO_BACKEND").as_deref() {
            Ok("core-audio") | Ok("core_audio") => "Core Audio capture started".to_string(),
            _ => "ScreenCaptureKit audio capture started".to_string(),
        }
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
    last_partial_end_sample: Option<u64>,
    live_partial_first_samples: u64,
    live_partial_interval_samples: u64,
    live_partials_enabled: bool,
    partial_revision: u64,
    speech_started_emitted_for: Option<u64>,
}

#[derive(Clone, Debug)]
enum PipelineOutput {
    SpeechStarted {
        source: TranscriptSource,
        utterance_id: u64,
        start_ms: u64,
    },
    Segment(SpeechSegment),
    PartialSnapshot(SpeechPartialSnapshot),
}

impl SourcePipeline {
    fn new(source: TranscriptSource, clock: PipelineClock, endpoint_config: EndpointConfig) -> Self {
        Self {
            source,
            clock,
            resampler: StreamResampler::new(),
            endpoint: EndpointDetector::new(endpoint_config),
            next_utterance_id: 1,
            active_utterance_id: None,
            last_partial_end_sample: None,
            live_partial_first_samples: ms_to_samples(live_partial_first_ms()),
            live_partial_interval_samples: ms_to_samples(live_partial_interval_ms()),
            live_partials_enabled: live_partials_enabled(),
            partial_revision: 0,
            speech_started_emitted_for: None,
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
            if let Some(output) = self.maybe_speech_started() {
                outputs.push(output);
            }

            if let Some(output) = self.maybe_partial_snapshot() {
                outputs.push(output);
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
        self.last_partial_end_sample = None;
        self.partial_revision = 0;
        self.speech_started_emitted_for = None;

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

    fn maybe_speech_started(&mut self) -> Option<PipelineOutput> {
        let snapshot = self.endpoint.active_snapshot()?;
        let active_duration = snapshot.end_sample.saturating_sub(snapshot.start_sample);

        if active_duration < ms_to_samples(DEFAULT_MIN_SPEECH_MS) {
            return None;
        }

        let id = self.active_utterance_id.unwrap_or_else(|| {
            self.active_utterance_id = Some(self.next_utterance_id);
            self.next_utterance_id
        });

        if self.speech_started_emitted_for == Some(id) {
            return None;
        }

        self.speech_started_emitted_for = Some(id);

        Some(PipelineOutput::SpeechStarted {
            source: self.source,
            utterance_id: id,
            start_ms: samples_to_ms(snapshot.start_sample),
        })
    }

    fn maybe_partial_snapshot(&mut self) -> Option<PipelineOutput> {
        if !self.live_partials_enabled {
            return None;
        }

        let snapshot = self.endpoint.active_snapshot()?;
        let active_duration = snapshot.end_sample.saturating_sub(snapshot.start_sample);

        if active_duration < self.live_partial_first_samples {
            return None;
        }

        if let Some(last_partial_end_sample) = self.last_partial_end_sample {
            if snapshot.end_sample.saturating_sub(last_partial_end_sample)
                < self.live_partial_interval_samples
            {
                return None;
            }
        }

        let id = self.active_utterance_id.unwrap_or_else(|| {
            self.active_utterance_id = Some(self.next_utterance_id);
            self.next_utterance_id
        });
        self.partial_revision = self.partial_revision.saturating_add(1);
        self.last_partial_end_sample = Some(snapshot.end_sample);

        Some(PipelineOutput::PartialSnapshot(SpeechPartialSnapshot {
            source: self.source,
            utterance_id: id,
            start_ms: samples_to_ms(snapshot.start_sample),
            end_ms: samples_to_ms(snapshot.end_sample),
            revision: self.partial_revision,
            queued_at_ms: self.clock.elapsed_ms(),
            samples: snapshot.samples,
        }))
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
        // Live-call endpointing keeps enough context to avoid clipped first words, ignores
        // tiny clicks, closes on short pauses and caps long monologues into bounded ASR jobs.
        Self {
            frame_samples: VAD_FRAME_SAMPLES,
            pre_roll_samples: ms_to_samples(DEFAULT_PRE_ROLL_MS) as usize,
            min_speech_samples: ms_to_samples(DEFAULT_MIN_SPEECH_MS) as usize,
            end_silence_samples: ms_to_samples(DEFAULT_END_SILENCE_MS) as usize,
            max_utterance_samples: ms_to_samples(DEFAULT_MAX_UTTERANCE_MS) as usize,
            energy_threshold: DEFAULT_ENERGY_SPEECH_THRESHOLD,
        }
    }
}

impl EndpointConfig {
    fn from_environment() -> Self {
        let mut config = Self::default();

        if let Some(end_silence_ms) = env_u64("CAUL_ENDPOINT_END_SILENCE_MS") {
            config.end_silence_samples = ms_to_samples(end_silence_ms) as usize;
        }

        if let Some(energy_threshold) = env_f32("CAUL_ENDPOINT_ENERGY_THRESHOLD") {
            config.energy_threshold = energy_threshold.max(0.0);
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

fn speech_frame_samples() -> Vec<f32> {
    vec![0.05; VAD_FRAME_SAMPLES]
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
    queue_metrics: AsrQueueMetrics,
) {
    let selected_model = LocalTranscriptionModel::from_environment();
    let mut model: Option<LocalTranscriber> = None;
    if preload_local_transcription_enabled() {
        let _ = get_or_load_local_model(&mut model, selected_model, &event_tx);
    }

    while let Ok(job) = receiver.recv() {
        match job {
            TranscriptionJob::Warmup => {
                let _ = get_or_load_local_model(&mut model, selected_model, &event_tx);
            }
            TranscriptionJob::SpeechStarted {
                source,
                utterance_id,
                start_ms,
            } => {
                let _ = event_tx.send(BackendEvent::SpeechStarted {
                    source,
                    utterance_id,
                    start_ms,
                });
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

                let Some(model) = get_or_load_local_model(&mut model, selected_model, &event_tx)
                else {
                    queue_metrics.record_started(&event_tx, &clock);
                    queue_metrics.record_completed(&event_tx, &clock);
                    continue;
                };

                dump_segment_audio_if_requested(&segment, &event_tx);

                queue_metrics.record_started(&event_tx, &clock);
                segment.metrics.asr_started_at_ms = Some(clock.elapsed_ms());
                emit_metric(
                    &event_tx,
                    "asr_started_at",
                    segment.id,
                    segment.metrics.asr_started_at_ms,
                );

                let text = transcribe_samples(model, &segment.samples, &event_tx)
                    .map(|text| suppress_pathological_repetitions(&text));
                segment.metrics.asr_completed_at_ms = Some(clock.elapsed_ms());
                queue_metrics.record_completed(&event_tx, &clock);
                emit_metric(
                    &event_tx,
                    "asr_completed_at",
                    segment.id,
                    segment.metrics.asr_completed_at_ms,
                );

                if let Some(text) = text {
                    let _ = event_tx.send(BackendEvent::Completed {
                        source: segment.source,
                        utterance_id: segment.id,
                        start_ms: segment.start_ms,
                        end_ms: segment.end_ms,
                        text: text.clone(),
                    });
                }
            }
            TranscriptionJob::PartialSnapshot(snapshot) => {
                let Some(model) = get_or_load_local_model(&mut model, selected_model, &event_tx)
                else {
                    queue_metrics.record_started(&event_tx, &clock);
                    queue_metrics.record_completed(&event_tx, &clock);
                    continue;
                };

                queue_metrics.record_started(&event_tx, &clock);
                let text = transcribe_samples(model, &snapshot.samples, &event_tx)
                    .map(|text| suppress_pathological_repetitions(&text));
                queue_metrics.record_completed(&event_tx, &clock);

                if let Some(text) = text {
                    let text = text.trim().to_string();

                    if !text.is_empty() {
                        let _ = event_tx.send(BackendEvent::Partial {
                            source: snapshot.source,
                            utterance_id: snapshot.utterance_id,
                            start_ms: snapshot.start_ms,
                            end_ms: snapshot.end_ms,
                            revision: snapshot.revision,
                            text,
                        });
                    }
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
    let Ok(directory) = std::env::var("CAUL_DUMP_UTTERANCE_DIR") else {
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
            value: None,
        });
    }
}

fn pipeline_metrics_enabled() -> bool {
    std::env::var("CAUL_PIPELINE_METRICS").is_ok_and(|value| value == "1" || value == "true")
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
}

fn env_f32(name: &str) -> Option<f32> {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
}

fn preload_local_transcription_enabled() -> bool {
    std::env::var("CAUL_PRELOAD_LOCAL_TRANSCRIPTION")
        .or_else(|_| std::env::var("CAUL_PRELOAD_PARAKEET"))
        .is_ok_and(|value| value == "1" || value == "true")
}

fn expected_speech_end_ms() -> Option<u64> {
    std::env::var("CAUL_BENCH_EXPECTED_SPEECH_END_MS")
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
        match std::env::var("CAUL_TRANSCRIPTION_MODEL")
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

fn ensure_parakeet_model() -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = std::env::var("CAUL_PARAKEET_MODEL_DIR") {
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
    if let Ok(path) = std::env::var("CAUL_MOONSHINE_MODEL_DIR") {
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
    if let Ok(path) = std::env::var("CAUL_MODEL_ROOT") {
        return PathBuf::from(path);
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Caul")
        .join("models")
}

fn drain_events(receiver: &mpsc::Receiver<BackendEvent>) {
    while let Ok(event) = receiver.try_recv() {
        emit_event(event);
    }
}

fn emit_event(event: BackendEvent) {
    let value = match event {
        BackendEvent::SpeechStarted {
            source,
            utterance_id,
            start_ms,
        } => json!({
            "type": "speech_started",
            "source": source.as_str(),
            "utterance_id": utterance_id,
            "start_ms": start_ms
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
        BackendEvent::Partial {
            source,
            utterance_id,
            start_ms,
            end_ms,
            revision,
            text,
        } => json!({
            "type": "transcription_partial",
            "source": source.as_str(),
            "utterance_id": utterance_id,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "revision": revision,
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
            value,
        } => json!({
            "type": "pipeline_metric",
            "name": name,
            "utterance_id": utterance_id,
            "at_ms": at_ms,
            "value": value
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
    fn sample_window_segmentation_ignores_empty_audio() {
        assert!(segment_sample_windows(0, ms_to_samples(30_000) as usize, 0).is_empty());
    }

    #[test]
    fn sample_window_segmentation_applies_overlap_and_bounds_chunks() {
        let chunk_samples = ms_to_samples(30_000) as usize;
        let overlap_samples = ms_to_samples(2_000) as usize;
        let total_samples = ms_to_samples(75_000) as usize;
        let windows = segment_sample_windows(total_samples, chunk_samples, overlap_samples);

        assert!(windows.len() > 1);
        assert!(windows.iter().all(|window| window.len() <= chunk_samples));
        assert_eq!(windows[0].start_sample, 0);
        assert_eq!(windows[0].end_sample, chunk_samples);
        assert_eq!(
            windows[1].start_sample,
            chunk_samples.saturating_sub(overlap_samples)
        );
        assert_eq!(windows.last().map(|window| window.end_sample), Some(total_samples));
    }

    #[test]
    fn sample_window_segmentation_is_monotonic() {
        let windows = segment_sample_windows(
            ms_to_samples(120_000) as usize,
            ms_to_samples(30_000) as usize,
            ms_to_samples(2_000) as usize,
        );

        for pair in windows.windows(2) {
            assert!(pair[0].index < pair[1].index);
            assert!(pair[0].start_sample < pair[1].start_sample);
            assert!(pair[0].end_sample < pair[1].end_sample);
            assert!(pair[0].start_sample < pair[0].end_sample);
        }
    }

    #[test]
    fn direct_wav_uses_single_window_for_short_audio() {
        let windows = direct_wav_sample_windows(ms_to_samples(29_000) as usize);

        assert_eq!(windows.len(), 1);
        assert_eq!(samples_to_ms(windows[0].len() as u64), 29_000);
    }

    #[test]
    fn direct_wav_chunks_long_audio_before_parakeet() {
        let windows = direct_wav_sample_windows(ms_to_samples(75_000) as usize);

        assert!(windows.len() > 1);
        assert!(windows
            .iter()
            .all(|window| samples_to_ms(window.len() as u64) <= DIRECT_WAV_CHUNK_MS));
    }

    #[test]
    fn live_partial_snapshot_waits_for_first_threshold() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(1_470, 0.05),
        ));

        assert!(!outputs
            .iter()
            .any(|output| matches!(output, PipelineOutput::PartialSnapshot(_))));
    }

    #[test]
    fn live_partial_snapshot_emits_after_first_threshold_and_interval() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let first_outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(1_500, 0.05),
        ));
        let second_outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(1_470, 0.05),
        ));
        let third_outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(30, 0.05),
        ));

        let first_partial = first_outputs.iter().find_map(|output| match output {
            PipelineOutput::PartialSnapshot(snapshot) => Some(snapshot),
            _ => None,
        });
        let early_second_partial = second_outputs
            .iter()
            .any(|output| matches!(output, PipelineOutput::PartialSnapshot(_)));
        let second_partial = third_outputs.iter().find_map(|output| match output {
            PipelineOutput::PartialSnapshot(snapshot) => Some(snapshot),
            _ => None,
        });

        assert_eq!(first_partial.map(|snapshot| snapshot.revision), Some(1));
        assert!(!early_second_partial);
        assert_eq!(second_partial.map(|snapshot| snapshot.revision), Some(2));
    }

    #[test]
    fn live_partial_snapshot_and_final_segment_share_utterance_id() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let partial_id = pipeline
            .push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(1_500, 0.05),
            ))
            .into_iter()
            .find_map(|output| match output {
                PipelineOutput::PartialSnapshot(snapshot) => Some(snapshot.utterance_id),
                _ => None,
            })
            .expect("partial should emit");
        let segment_id = pipeline
            .push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(DEFAULT_END_SILENCE_MS, 0.0),
            ))
            .into_iter()
            .find_map(|output| match output {
                PipelineOutput::Segment(segment) => Some(segment.id),
                _ => None,
            })
            .expect("final segment should emit");

        assert_eq!(partial_id, segment_id);
    }

    #[test]
    fn queue_guard_skips_partial_snapshot_when_asr_is_busy() {
        let clock = PipelineClock::new();
        let (job_tx, job_rx) = mpsc::channel();
        let (event_tx, _event_rx) = mpsc::channel();
        let queue_metrics = AsrQueueMetrics::default();
        let snapshot = SpeechPartialSnapshot {
            source: TranscriptSource::System,
            utterance_id: 1,
            start_ms: 0,
            end_ms: 1_500,
            revision: 1,
            queued_at_ms: clock.elapsed_ms(),
            samples: samples_for_ms(1_500, 0.05),
        };

        queue_metrics.record_queued(clock.elapsed_ms(), &event_tx, &clock);
        enqueue_partial_snapshot_job(&job_tx, snapshot, &queue_metrics, &event_tx, &clock);

        assert!(job_rx.try_recv().is_err());
    }

    #[test]
    fn stop_flush_does_not_create_partial_snapshot() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let _ = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(1_500, 0.05),
        ));

        let segment = pipeline.flush().expect("stop flush should produce final segment");

        assert_eq!(segment.id, 1);
    }

    fn test_direct_chunk(index: usize, transcript: &str) -> DirectWavChunkSummary {
        DirectWavChunkSummary {
            index,
            start_ms: index as u64 * 28_000,
            end_ms: index as u64 * 28_000 + 30_000,
            audio_duration_ms: 30_000,
            samples: ms_to_samples(30_000) as usize,
            asr_ms: 1,
            transcript: transcript.to_string(),
        }
    }

    #[test]
    fn chunk_stitching_removes_exact_suffix_prefix_overlap() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(
                0,
                "Alice looked at the White Rabbit and hurried down the hall",
            ),
            test_direct_chunk(
                1,
                "White Rabbit and hurried down the hall after the sound",
            ),
        ]);

        assert_eq!(
            stitched.transcript,
            "Alice looked at the White Rabbit and hurried down the hall\nafter the sound"
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Exact);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 7);
        assert_eq!(stitched.chunks[1].overlap_words, 7);
    }

    #[test]
    fn chunk_stitching_matches_case_and_punctuation_but_preserves_next_text() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(0, "She said, Rabbit with pink eyes came close."),
            test_direct_chunk(1, "rabbit with pink eyes came close and hurried away."),
        ]);

        assert_eq!(
            stitched.transcript,
            "She said, Rabbit with pink eyes came close.\nand hurried away."
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Exact);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 6);
    }

    #[test]
    fn chunk_stitching_does_not_merge_short_common_phrases() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(0, "We are nearly at the end"),
            test_direct_chunk(1, "the end begins again"),
        ]);

        assert_eq!(
            stitched.transcript,
            "We are nearly at the end\nthe end begins again"
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Append);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 0);
    }

    #[test]
    fn chunk_stitching_lcs_fallback_handles_inserted_boundary_word() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(0, "Alice saw the white rabbit run under the hedge"),
            test_direct_chunk(1, "white rabbit quickly run under the hedge and vanished"),
        ]);

        assert_eq!(
            stitched.transcript,
            "Alice saw the white rabbit run under the hedge\nand vanished"
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Lcs);
        assert_eq!(stitched.chunks[1].overlap_words, 6);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 7);
    }

    #[test]
    fn chunk_stitching_replaces_short_flawed_previous_boundary_tail() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(
                0,
                "It did not sound at all the right word. But I shall have to ask them what if the name of the",
            ),
            test_direct_chunk(
                1,
                "But I shall have to ask them what the name of the country is, you know.",
            ),
        ]);

        assert_eq!(
            stitched.transcript,
            "It did not sound at all the right word.\nBut I shall have to ask them what the name of the country is, you know."
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Lcs);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 0);
        assert!(stitched.chunks[1].dropped_previous_suffix_words > 0);
    }

    #[test]
    fn chunk_stitching_avoids_repeated_phrase_far_from_boundary() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(
                0,
                "north south east west begins the scene before a small quiet tail",
            ),
            test_direct_chunk(1, "north south east west then the story continues"),
        ]);

        assert_eq!(
            stitched.transcript,
            "north south east west begins the scene before a small quiet tail\nnorth south east west then the story continues"
        );
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Append);
    }

    #[test]
    fn chunk_stitching_does_not_follow_sparse_lcs_deep_into_next_chunk() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(
                0,
                "She was walking with Dinah before another long passage and the white rabbit was still in sight hurrying down it.",
            ),
            test_direct_chunk(
                1,
                "Alice opened the door and found it led into a small passage, not much larger than a rat hole. And even if my head would go through.",
            ),
        ]);

        assert!(stitched
            .transcript
            .contains("Alice opened the door and found it led into a small passage"));
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Append);
        assert_eq!(stitched.chunks[1].dropped_prefix_words, 0);
    }

    #[test]
    fn chunk_stitching_ignores_empty_chunks_safely() {
        let stitched = stitch_direct_wav_chunks(&[
            test_direct_chunk(0, ""),
            test_direct_chunk(1, "Only the useful chunk remains."),
            test_direct_chunk(2, ""),
        ]);

        assert_eq!(stitched.transcript, "Only the useful chunk remains.");
        assert_eq!(stitched.raw_transcript, "Only the useful chunk remains.");
        assert_eq!(stitched.chunks.len(), 3);
        assert!(stitched.chunks[0].transcript.is_empty());
        assert_eq!(stitched.chunks[1].strategy, StitchStrategy::Append);
    }

    fn test_session(source: TranscriptSource, max_preroll_ms: u64) -> ActiveSession {
        let clock = PipelineClock::new();
        let endpoint_config = EndpointConfig::default();
        let mut batchers = HashMap::new();
        batchers.insert(source, SourcePipeline::new(source, clock, endpoint_config));

        ActiveSession {
            _microphone_capture: None,
            system_thread: None,
            running: Arc::new(AtomicBool::new(true)),
            batchers,
            sources: vec![source],
            accepting_audio: false,
            saw_audio: false,
            preroll_frames: VecDeque::new(),
            preroll_ms: 0,
            max_preroll_ms,
        }
    }

    #[test]
    fn parse_prepare_defaults_to_model_only() {
        let command = parse_daemon_command(r#"{"type":"prepare","sources":["system"]}"#)
            .expect("prepare command parses");

        match command {
            DaemonCommand::Prepare {
                sources,
                hot_capture,
            } => {
                assert_eq!(sources, vec![TranscriptSource::System]);
                assert!(!hot_capture);
            }
            _ => panic!("expected prepare command"),
        }
    }

    #[test]
    fn parse_prepare_can_explicitly_arm_hot_capture() {
        let command =
            parse_daemon_command(r#"{"type":"prepare","sources":["system"],"hotCapture":true}"#)
                .expect("prepare command parses");

        match command {
            DaemonCommand::Prepare {
                sources,
                hot_capture,
            } => {
                assert_eq!(sources, vec![TranscriptSource::System]);
                assert!(hot_capture);
            }
            _ => panic!("expected prepare command"),
        }
    }

    #[test]
    fn hot_capture_preroll_keeps_only_recent_frames() {
        let mut session = test_session(TranscriptSource::System, 500);

        session.buffer_preroll_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(300, 0.01),
        ));
        session.buffer_preroll_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(300, 0.02),
        ));

        assert_eq!(session.preroll_frames.len(), 1);
        assert_eq!(session.preroll_ms, 300);
        assert_eq!(
            session
                .preroll_frames
                .front()
                .and_then(|frame| frame.samples.first())
                .copied(),
            Some(0.02)
        );
    }

    #[test]
    fn hot_capture_preroll_ignores_unselected_sources() {
        let mut session = test_session(TranscriptSource::System, 500);

        session.buffer_preroll_frame(test_frame(
            TranscriptSource::Microphone,
            samples_for_ms(300, 0.01),
        ));

        assert!(session.preroll_frames.is_empty());
        assert_eq!(session.preroll_ms, 0);
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

        for _ in 0..(DEFAULT_END_SILENCE_MS / TEST_FRAME_MS + 1) {
            utterances.extend(detector.push_samples(&silence_frame(), &clock));
        }

        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].endpoint_reason, EndpointReason::Silence);
        assert!(utterances[0].samples.len() >= ms_to_samples(DEFAULT_MIN_SPEECH_MS) as usize);
    }

    #[test]
    fn vad_does_not_close_during_short_clause_pause() {
        let clock = PipelineClock::new();
        let mut detector = EndpointDetector::new(EndpointConfig::default());
        let mut utterances = Vec::new();

        for _ in 0..10 {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
        }

        for _ in 0..((DEFAULT_END_SILENCE_MS / TEST_FRAME_MS) - 2) {
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

        for _ in 0..(DEFAULT_MAX_UTTERANCE_MS / TEST_FRAME_MS + 1) {
            utterances.extend(detector.push_samples(&speech_frame(), &clock));
            if !utterances.is_empty() {
                break;
            }
        }

        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].endpoint_reason, EndpointReason::MaxDuration);
    }

    #[test]
    fn continuous_one_hour_speech_stays_bounded() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let frames = (60 * 60 * 1000) / VAD_FRAME_MS;
        let max_allowed_ms = DEFAULT_MAX_UTTERANCE_MS + VAD_FRAME_MS;
        let mut segment_count = 0;
        let mut previous_end_ms = 0;

        for _ in 0..frames {
            for output in pipeline.push_frame(test_frame(
                TranscriptSource::System,
                speech_frame_samples(),
            )) {
                if let PipelineOutput::Segment(segment) = output {
                    let segment_ms = segment.end_ms.saturating_sub(segment.start_ms);
                    assert!(segment_ms <= max_allowed_ms);
                    assert!(segment.start_ms >= previous_end_ms);
                    previous_end_ms = segment.end_ms;
                    segment_count += 1;
                }
            }
        }

        if let Some(segment) = pipeline.flush() {
            let segment_ms = segment.end_ms.saturating_sub(segment.start_ms);
            assert!(segment_ms <= max_allowed_ms);
            assert!(segment.start_ms >= previous_end_ms);
            segment_count += 1;
        }

        assert!(segment_count > 400);
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
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
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
    fn source_pipeline_does_not_emit_preview_before_endpoint() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(900, 0.05),
        ));

        assert!(outputs.iter().any(|output| matches!(
            output,
            PipelineOutput::SpeechStarted {
                source: TranscriptSource::System,
                utterance_id: 1,
                start_ms: 0,
            }
        )));
        assert!(!outputs.iter().any(|output| matches!(
            output,
            PipelineOutput::Segment(_)
        )));
    }

    #[test]
    fn source_pipeline_final_segment_reuses_speech_started_id() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let utterance_id = pipeline
            .push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(900, 0.05),
            ))
            .into_iter()
            .find_map(|output| match output {
                PipelineOutput::SpeechStarted { utterance_id, .. } => Some(utterance_id),
                PipelineOutput::PartialSnapshot(_) | PipelineOutput::Segment(_) => None,
            })
            .expect("speech-started should emit");
        let mut segments = Vec::new();

        collect_segments_into(
            &mut segments,
            pipeline.push_frame(test_frame(
                TranscriptSource::System,
                samples_for_ms(600, 0.0),
            )),
        );

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].id, utterance_id);
    }

    #[test]
    fn source_pipeline_emits_speech_started_once_before_segment() {
        let clock = PipelineClock::new();
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
        let outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(900, 0.05),
        ));

        assert!(matches!(
            outputs.first(),
            Some(PipelineOutput::SpeechStarted {
                source: TranscriptSource::System,
                utterance_id: 1,
                start_ms: 0,
            })
        ));

        let repeated_outputs = pipeline.push_frame(test_frame(
            TranscriptSource::System,
            samples_for_ms(300, 0.05),
        ));

        assert!(!repeated_outputs.iter().any(|output| matches!(
            output,
            PipelineOutput::SpeechStarted { .. }
        )));
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
        let mut pipeline = SourcePipeline::new(
            TranscriptSource::System,
            clock,
            EndpointConfig::default(),
        );
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
