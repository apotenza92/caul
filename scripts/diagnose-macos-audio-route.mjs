import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const helperPath = 'native/macos-audio-helper/.build/debug/CaulAudioHelper';
const defaultDurationMs = Number(process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_MS ?? 8_000);
const outputPath = process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_OUTPUT
  ?? path.join('artifacts', 'audio-route-diagnostics', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const nonInteractive = process.argv.includes('--non-interactive') || process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_NONINTERACTIVE === '1';
const skipSpeakerPlayback = process.argv.includes('--skip-speaker') || process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_SKIP_SPEAKER === '1';
const outputUID = readOption('--set-output-uid') ?? process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_OUTPUT_UID;
const restoreOutput = process.argv.includes('--restore-output') || process.env.CAUL_AUDIO_ROUTE_DIAGNOSTIC_RESTORE_OUTPUT === '1';

const phases = [
  {
    id: 'silence',
    prompt: 'Keep the room and speakers quiet. Press Enter to capture silence.',
    playback: false,
    transcribe: false
  },
  {
    id: 'mic_speech',
    prompt: 'Speak into the Scarlett microphone only, with no intentional speaker playback. Press Enter when ready.',
    playback: false,
    transcribe: true
  },
  {
    id: 'speaker_playback',
    prompt: 'Known spoken audio will play through the current output device. Press Enter when ready.',
    playback: !skipSpeakerPlayback,
    transcribe: true
  }
];

const backends = [
  {
    id: 'core_audio_process_tap',
    helperArgs: ['--stream-system-audio']
  },
  {
    id: 'screencapturekit_audio',
    helperArgs: ['--stream-screencapturekit-audio']
  }
];

const rl = nonInteractive ? null : createInterface({ input, output });
const originalOutputID = outputUID && restoreOutput ? getDefaultSystemOutputID() : null;

try {
  if (outputUID) {
    const outputID = getDeviceIDByUID(outputUID);

    if (outputID === null) {
      throw new Error(`No Core Audio output device found with UID ${outputUID}`);
    }

    console.log(`Switching default output to UID ${outputUID} (${outputID})`);
    setDefaultOutputID(outputID);
    await wait(750);
  }

  const report = {
    kind: 'caul.macosAudioRouteDiagnostic',
    version: 1,
    createdAt: new Date().toISOString(),
    durationMs: defaultDurationMs,
    outputPath,
    requestedOutputUID: outputUID ?? null,
    restoredOutputID: originalOutputID,
    notes: [
      'Dev-only evidence harness. It does not launch Caul and does not change product capture behaviour.',
      'ScreenCaptureKit uses captureMicrophone=false where supported by macOS.',
      'A transcript during mic_speech with Input intentionally off is evidence that the output route contains microphone speech.'
    ],
    runs: []
  };

  for (const phase of phases) {
    if (rl) {
      await rl.question(`\n${phase.prompt}\n`);
    }

    for (const backend of backends) {
      const route = readAudioRoute();
      console.log(`Running ${backend.id} / ${phase.id} on input="${route.defaultInput?.name ?? 'unknown'}" output="${route.defaultOutput?.name ?? 'unknown'}"`);

      const result = await runCapture({
        backend,
        phase,
        durationMs: defaultDurationMs
      });

      report.runs.push({
        phase: phase.id,
        backend: backend.id,
        route,
        ...result
      });
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\ncaul-macos-audio-route-diagnostic ${JSON.stringify(summariseReport(report))}`);
  console.log(`Wrote ${outputPath}`);
} finally {
  if (originalOutputID !== null) {
    console.log(`Restoring default output to ${originalOutputID}`);
    setDefaultOutputID(originalOutputID);
  }

  rl?.close();
}

function readAudioRoute() {
  const result = spawnSync('system_profiler', ['SPAudioDataType', '-json'], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return {
      error: result.stderr.trim() || `system_profiler exited with ${result.status}`
    };
  }

  try {
    const profile = JSON.parse(result.stdout);
    const devices = (profile.SPAudioDataType ?? [])
      .flatMap((section) => section._items ?? [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        name: item._name,
        manufacturer: item.coreaudio_device_manufacturer,
        inputChannels: Number(item.coreaudio_device_input ?? 0),
        outputChannels: Number(item.coreaudio_device_output ?? 0),
        sampleRate: Number(item.coreaudio_device_srate ?? 0),
        transport: item.coreaudio_device_transport,
        defaultInput: item.coreaudio_default_audio_input_device === 'spaudio_yes',
        defaultOutput: item.coreaudio_default_audio_output_device === 'spaudio_yes',
        defaultSystemOutput: item.coreaudio_default_audio_system_device === 'spaudio_yes'
      }));

    return {
      defaultInput: devices.find((device) => device.defaultInput) ?? null,
      defaultOutput: devices.find((device) => device.defaultOutput) ?? null,
      defaultSystemOutput: devices.find((device) => device.defaultSystemOutput) ?? null,
      devices
    };
  } catch (error) {
    return {
      error: `system_profiler returned unreadable JSON: ${error.message}`
    };
  }
}

async function runCapture({ backend, phase, durationMs }) {
  const errors = [];
  const stages = [];
  const transcripts = [];
  const levels = [];
  let audioFrames = 0;
  let captureStarted = false;
  let speaker = null;

  if (phase.playback) {
    speaker = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
      env: {
        ...process.env,
        CAUL_BROWSER_SPEECH_MS: String(durationMs + 4_000),
        CAUL_BROWSER_SPEECH_TEXT: 'Caul Scarlett route diagnostic. This spoken audio should appear only during the speaker playback phase.',
        CAUL_BROWSER_SPEECH_LOOP: 'true'
      },
      stdio: nonInteractive ? 'ignore' : 'inherit'
    });

    await wait(1_500);
  }

  const helperArgs = [
    ...backend.helperArgs,
    ...(phase.transcribe ? ['--transcribe-parakeet'] : []),
    '--duration',
    String(Math.ceil(durationMs / 1_000))
  ];

  const helper = spawn(helperPath, helperArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let lineBuffer = '';
  helper.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString();

    let newlineIndex = lineBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);

      if (line) {
        handleEventLine(line);
      }

      newlineIndex = lineBuffer.indexOf('\n');
    }
  });

  helper.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message && !isIgnorableHelperStderr(message)) {
      errors.push(message);
      process.stderr.write(chunk);
    }
  });

  const exitCode = await new Promise((resolve) => {
    helper.on('exit', (code) => resolve(code ?? 1));
  });

  if (lineBuffer.trim()) {
    handleEventLine(lineBuffer.trim());
  }

  speaker?.kill('SIGTERM');

  const peakPercent = levels.reduce((max, level) => Math.max(max, level.level), 0);
  const peakDecibels = levels.reduce((max, level) => Math.max(max, level.decibels), -120);
  const rmsPercent = Math.sqrt(levels.reduce((sum, level) => sum + (level.level ** 2), 0) / Math.max(1, levels.length));

  return {
    ok: exitCode === 0 && errors.length === 0,
    exitCode,
    helperArgs,
    captureStarted,
    audioFrames,
    levelEvents: levels.length,
    peakPercent: round(peakPercent),
    rmsPercent: round(rmsPercent),
    peakDecibels: round(peakDecibels),
    transcriptCount: transcripts.length,
    transcriptText: transcripts.join('\n').trim(),
    stages,
    errors
  };

  function handleEventLine(line) {
    let event;

    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`unreadable helper line: ${line.slice(0, 160)}`);
      return;
    }

    if (event.type === 'capture_started') {
      captureStarted = true;
      return;
    }

    if (event.type === 'audio_frame') {
      audioFrames += 1;
      return;
    }

    if (event.type === 'system_level') {
      levels.push({
        level: Number(event.level ?? 0),
        decibels: Number(event.decibels ?? -120)
      });
      return;
    }

    if (event.type === 'capture_stage') {
      stages.push(event.message ?? event.type);
      return;
    }

    if ((event.type === 'transcription_completed' || event.type === 'transcription_partial') && event.text) {
      transcripts.push(event.text);
      return;
    }

    if (event.type === 'permission_error' || event.type === 'capture_error') {
      errors.push(event.message ?? event.type);
    }
  }
}

function summariseReport(report) {
  return {
    outputPath: report.outputPath,
    runs: report.runs.map((run) => ({
      phase: run.phase,
      backend: run.backend,
      input: run.route.defaultInput?.name ?? null,
      output: run.route.defaultOutput?.name ?? null,
      captureStarted: run.captureStarted,
      audioFrames: run.audioFrames,
      peakPercent: run.peakPercent,
      rmsPercent: run.rmsPercent,
      transcriptCount: run.transcriptCount,
      ok: run.ok
    }))
  };
}

function isIgnorableHelperStderr(message) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.every((line) => (
    /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|DEBUG)\] \[FluidAudio\./.test(line) ||
    /The file .?manifest\.plist.? couldn.?t be opened because there is no such file\./.test(line)
  ));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readOption(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return null;
}

function getDefaultSystemOutputID() {
  const output = runSwift(`
import CoreAudio
var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var id = AudioObjectID(kAudioObjectUnknown)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
if status == noErr { print(id) }
`);
  const id = Number(output.trim());
  return Number.isFinite(id) ? id : null;
}

function getDeviceIDByUID(uid) {
  const output = runSwift(`
import CoreAudio
import Foundation
let targetUID = ${JSON.stringify(uid)}
func stringProperty(_ objectID: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: CFString?
  var size = UInt32(MemoryLayout<CFString?>.size)
  let status = withUnsafeMutablePointer(to: &value) { pointer in
    AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, pointer)
  }
  guard status == noErr else { return nil }
  return value as String?
}
var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0
AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
let count = Int(size) / MemoryLayout<AudioObjectID>.size
var devices = Array(repeating: AudioObjectID(kAudioObjectUnknown), count: count)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices)
for device in devices {
  if stringProperty(device, kAudioDevicePropertyDeviceUID) == targetUID {
    print(device)
    break
  }
}
`);
  const id = Number(output.trim());
  return Number.isFinite(id) ? id : null;
}

function setDefaultOutputID(id) {
  runSwift(`
import CoreAudio
let target = AudioObjectID(${JSON.stringify(id)})
for selector in [kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDefaultSystemOutputDevice] {
  var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value = target
  let size = UInt32(MemoryLayout<AudioObjectID>.size)
  _ = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, size, &value)
}
`);
}

function runSwift(source) {
  const result = spawnSync('swift', ['-'], {
    input: source,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'swift command failed');
  }

  return result.stdout;
}
