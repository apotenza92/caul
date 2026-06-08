export const defaultMicrophoneLeakAbsoluteThreshold = 0.001;
export const defaultMicrophoneLeakRatioThreshold = 0.08;

export function parseSmokeSummaryByType(text, type) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === type) {
        return parsed;
      }
    } catch {
      // Ignore non-JSON command output.
    }
  }

  return null;
}

export function evaluateAudioIsolationGate({
  microphoneDuringOutput,
  systemDuringOutput,
  microphoneLeakAbsoluteThreshold = defaultMicrophoneLeakAbsoluteThreshold,
  microphoneLeakRatioThreshold = defaultMicrophoneLeakRatioThreshold
}) {
  const outputDetected = meetsMinimumSystemCaptureGate(systemDuringOutput);
  const microphoneCaptureStarted = microphoneDuringOutput?.capture_started === true
    && Number(microphoneDuringOutput.audio_frames ?? 0) > 0
    && Number(microphoneDuringOutput.level_events ?? 0) > 0;
  const microphoneMaxLevel = Number(microphoneDuringOutput?.max_level ?? 0);
  const systemMaxLevel = Number(systemDuringOutput?.max_level ?? 0);
  const ratioLimit = systemMaxLevel > 0
    ? systemMaxLevel * microphoneLeakRatioThreshold
    : microphoneLeakAbsoluteThreshold;
  const microphoneLeakLimit = Math.max(microphoneLeakAbsoluteThreshold, ratioLimit);
  const microphoneLeakDetected = microphoneCaptureStarted && microphoneMaxLevel > microphoneLeakLimit;

  return {
    microphoneCaptureStarted,
    microphoneLeakAbsoluteThreshold,
    microphoneLeakDetected,
    microphoneLeakLimit,
    microphoneLeakRatioThreshold,
    microphoneMaxLevel,
    ok: outputDetected && microphoneCaptureStarted && !microphoneLeakDetected,
    outputDetected,
    systemMaxLevel
  };
}

export function meetsMinimumSystemCaptureGate(summary) {
  return summary?.capture_started === true
    && Number(summary.audio_frames ?? 0) > 0
    && Number(summary.level_events ?? 0) > 0
    && Number(summary.max_level ?? 0) > 0.000001;
}
