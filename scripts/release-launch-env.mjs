const inheritedEnvironmentNames = [
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'WINDIR',
  'XDG_RUNTIME_DIR'
];

export function createReleaseLaunchEnvironment(overrides = {}, source = process.env) {
  const environment = {};
  for (const name of inheritedEnvironmentNames) {
    if (typeof source[name] === 'string' && source[name] !== '') {
      environment[name] = source[name];
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (typeof value === 'string') {
      environment[name] = value;
    }
  }
  return environment;
}
