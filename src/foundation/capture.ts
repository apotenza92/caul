export type CaptureSource = 'microphone' | 'system';

export type CaptureRunState = 'idle' | 'testing' | 'paused';

export type CaptureLevel = {
  source: CaptureSource;
  level: number;
  label: string;
};

export type CaptureStatus = {
  state: CaptureRunState;
  levels: Record<CaptureSource, CaptureLevel>;
};

export type CaptureAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'status'; status: CaptureStatus }
  | { type: 'levels'; microphone: number; system: number };

export const initialCaptureStatus: CaptureStatus = {
  state: 'idle',
  levels: {
    microphone: {
      source: 'microphone',
      level: 38,
      label: '-24 dB'
    },
    system: {
      source: 'system',
      level: 52,
      label: '-18 dB'
    }
  }
};

export function clampCaptureLevel(value: number) {
  return Math.max(8, Math.min(96, value));
}

export function reduceCaptureStatus(status: CaptureStatus, action: CaptureAction): CaptureStatus {
  if (action.type === 'start') {
    return {
      ...status,
      state: 'testing'
    };
  }

  if (action.type === 'pause') {
    return {
      ...status,
      state: 'paused'
    };
  }

  if (action.type === 'stop') {
    return {
      ...status,
      state: 'idle'
    };
  }

  if (action.type === 'status') {
    return action.status;
  }

  return {
    ...status,
    levels: {
      microphone: {
        ...status.levels.microphone,
        level: clampCaptureLevel(action.microphone)
      },
      system: {
        ...status.levels.system,
        level: clampCaptureLevel(action.system)
      }
    }
  };
}

export function getCaptureStatusText(state: CaptureRunState) {
  if (state === 'testing') {
    return 'Listening';
  }

  if (state === 'paused') {
    return 'Paused';
  }

  return 'Not listening';
}

export function nextMockLevels(status: CaptureStatus, random = Math.random) {
  return {
    microphone: clampCaptureLevel(status.levels.microphone.level + random() * 28 - 12),
    system: clampCaptureLevel(status.levels.system.level + random() * 32 - 14)
  };
}
