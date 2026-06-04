function getSystemAudioPermissionStatusFromState(state) {
  if (state?.systemAudioPermissionDenied === true) {
    return 'denied';
  }

  if (state?.systemAudioPermissionGranted === true) {
    return 'granted';
  }

  return 'not-determined';
}

function getSystemAudioPermissionRequestedState(update) {
  return {
    systemAudioPermissionDenied: false,
    systemAudioPermissionGranted: false,
    systemAudioPermissionRequested: true,
    ...update
  };
}

function getSystemAudioPermissionGrantedState(update) {
  return {
    systemAudioPermissionDenied: false,
    systemAudioPermissionGranted: true,
    systemAudioPermissionRequested: true,
    ...update
  };
}

function getSystemAudioPermissionDeniedState(update) {
  return {
    systemAudioPermissionDenied: true,
    systemAudioPermissionGranted: false,
    systemAudioPermissionRequested: true,
    ...update
  };
}

function isSystemAudioPermissionProbeGrantedEvent(event) {
  return event?.type === 'system_level' || event?.type === 'audio_frame';
}

module.exports = {
  getSystemAudioPermissionDeniedState,
  getSystemAudioPermissionGrantedState,
  getSystemAudioPermissionRequestedState,
  getSystemAudioPermissionStatusFromState,
  isSystemAudioPermissionProbeGrantedEvent
};
