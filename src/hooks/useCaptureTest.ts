import { useEffect, useReducer } from 'react';
import { initialCaptureStatus, nextMockLevels, reduceCaptureStatus } from '../foundation/capture';
import { getCaptureBridge } from '../foundation/desktopBridge';

export function useCaptureTest() {
  const [captureStatus, dispatchCapture] = useReducer(reduceCaptureStatus, initialCaptureStatus);

  useEffect(() => {
    getCaptureBridge()?.status().then((status) => {
      dispatchCapture({
        type: 'status',
        status
      });
    }).catch(() => {
      dispatchCapture({
        type: 'status',
        status: initialCaptureStatus
      });
    });
  }, []);

  useEffect(() => {
    if (captureStatus.state !== 'testing') {
      return;
    }

    const interval = window.setInterval(() => {
      const levels = nextMockLevels(captureStatus);

      dispatchCapture({
        type: 'levels',
        microphone: levels.microphone,
        system: levels.system
      });
    }, 420);

    return () => window.clearInterval(interval);
  }, [captureStatus]);

  async function runCaptureCommand(command: 'pause' | 'start' | 'stop') {
    const bridge = getCaptureBridge();

    if (!bridge) {
      dispatchCapture({ type: command });
      return;
    }

    try {
      dispatchCapture({
        type: 'status',
        status: await bridge[command]()
      });
    } catch {
      dispatchCapture({ type: command });
    }
  }

  return {
    captureStatus,
    startCaptureTest: () => void runCaptureCommand('start'),
    pauseCaptureTest: () => void runCaptureCommand('pause'),
    stopCaptureTest: () => void runCaptureCommand('stop')
  };
}
