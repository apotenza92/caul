const sharedSourcePatterns = [
  /^\/media\/psf\/caul(?:\/|$)/i,
  /^\/Volumes\/caul(?:\/|$)/i,
  /^\/Users\/alex\/code\/caul(?:\/|$)/i,
  /^\\\\Mac\\Home\\code\\caul(?:\\|$)/i
];

const disposableRoots = {
  linux: [/^\/home\/parallels\/caul-e2e(?:\/|$)/],
  macos: [/^\/Users\/alex\/caul-e2e(?:\/|$)/],
  win: [/^C:\\Users\\alex\\caul-e2e(?:\\|$)/i]
};

export function isSharedSourcePath(value) {
  return sharedSourcePatterns.some((pattern) => pattern.test(String(value)));
}

export function assertDisposableVmPath(value, profileName) {
  const path = String(value);

  if (isSharedSourcePath(path)) {
    throw new Error(`Refusing to remove shared source path: ${path}`);
  }

  const roots = disposableRoots[profileName] ?? [];

  if (!roots.some((pattern) => pattern.test(path))) {
    throw new Error(`Refusing to remove non-disposable VM path for ${profileName}: ${path}`);
  }

  return true;
}

export function shouldRemoveVmReleaseArtefact(value, profileName) {
  try {
    assertDisposableVmPath(value, profileName);
    return true;
  } catch {
    return false;
  }
}
