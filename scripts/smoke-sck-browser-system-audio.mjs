import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

const durationMs = Number(process.env.SUSURA_SCK_SMOKE_MS ?? 6_000);
const helperPath = 'native/macos-audio-helper/.build/debug/SusuraAudioHelper';
const routeBuiltInOutput = process.env.SUSURA_SCK_ROUTE_BUILTIN_OUTPUT !== '0';
let maxLevel = 0;
let maxDecibels = -120;
let levelEvents = 0;
let audioFrames = 0;
let started = false;
let lineBuffer = '';
const errors = [];
const originalOutputID = routeBuiltInOutput ? getDefaultSystemOutputID() : null;
const builtInOutputID = routeBuiltInOutput ? getDeviceIDByUID('BuiltInSpeakerDevice') : null;

if (routeBuiltInOutput && builtInOutputID !== null) {
  setDefaultOutputID(builtInOutputID);
}

const tone = spawn(process.execPath, ['scripts/browser-audio-tone.mjs'], {
  env: {
    ...process.env,
    SUSURA_BROWSER_TONE_MS: String(durationMs + 4_000)
  },
  stdio: 'inherit'
});

await new Promise((resolve) => setTimeout(resolve, 1_000));

const helper = spawn(helperPath, [
  '--stream-screencapturekit-audio',
  '--duration',
  String(Math.ceil(durationMs / 1_000))
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

helper.stdout.on('data', (chunk) => {
  lineBuffer += chunk.toString();

  let newlineIndex = lineBuffer.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = lineBuffer.slice(0, newlineIndex).trim();
    lineBuffer = lineBuffer.slice(newlineIndex + 1);

    if (line) {
      handleLine(line);
    }

    newlineIndex = lineBuffer.indexOf('\n');
  }
});

helper.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

const code = await new Promise((resolve) => {
  helper.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (lineBuffer.trim()) {
  handleLine(lineBuffer.trim());
}

tone.kill('SIGTERM');

if (originalOutputID !== null) {
  setDefaultOutputID(originalOutputID);
}

const summary = {
  started,
  audioFrames,
  levelEvents,
  maxLevel,
  maxDecibels,
  detected: maxLevel > 1,
  errors
};

console.log(`susura-sck-browser-system-audio-smoke ${JSON.stringify(summary)}`);

if (!summary.detected) {
  process.exit(1);
}

process.exit(code);

function handleLine(line) {
  let event;

  try {
    event = JSON.parse(line);
  } catch {
    errors.push(`unreadable helper line: ${line.slice(0, 80)}`);
    return;
  }

  if (event.type === 'capture_started') {
    started = true;
    return;
  }

  if (event.type === 'audio_frame') {
    audioFrames += 1;
    return;
  }

  if (event.type === 'system_level') {
    levelEvents += 1;
    maxLevel = Math.max(maxLevel, Number(event.level ?? 0));
    maxDecibels = Math.max(maxDecibels, Number(event.decibels ?? -120));
    return;
  }

  if (event.type === 'permission_error' || event.type === 'capture_error') {
    errors.push(event.message ?? event.type);
  }
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
