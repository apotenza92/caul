const profiles = {
  macos: {
    backendPath: '/Users/alex/caul-e2e/Caul.app/Contents/Resources/bin/caul-desktop-backend',
    buildCommand: 'npm run dist:mac:arm',
    envPrefix: 'CAUL_MACOS',
    localPackagePath: 'release/mac-arm64/Caul.app',
    modelDir: '/Users/alex/caul-e2e/models/parakeet-tdt-0.6b-v3-int8',
    packageType: 'app',
    platform: 'macos',
    releaseDir: '/Users/alex/caul-e2e/release',
    repoPath: '/Users/alex/caul-e2e/repo',
    stagedPackagePath: '/Users/alex/caul-e2e/Caul.app',
    user: 'alex',
    vmName: 'macOS'
  },
  win: {
    backendPath: 'C:\\Users\\alex\\AppData\\Local\\Programs\\Caul\\resources\\bin\\caul-desktop-backend.exe',
    buildCommand: 'npm run dist:win:arm64',
    envPrefix: 'CAUL_WINDOWS',
    localPackagePath: 'release/Caul-windows-arm64-setup.exe',
    modelDir: 'C:\\Users\\alex\\AppData\\Roaming\\com.pais.handy\\models\\parakeet-tdt-0.6b-v3-int8',
    packageType: 'exe',
    platform: 'win',
    releaseDir: 'C:\\Users\\alex\\caul-e2e\\release',
    repoPath: 'C:\\Users\\alex\\caul-e2e\\repo',
    stagedPackagePath: 'C:\\Users\\alex\\caul-e2e\\release\\Caul-windows-arm64-setup.exe',
    user: 'alex',
    vmName: 'Windows 11 ARM'
  },
  linux: {
    backendPath: '/opt/Caul/resources/bin/caul-desktop-backend',
    buildCommand: 'npm run dist:linux:arm64',
    envPrefix: 'CAUL_LINUX',
    host: '10.211.55.12',
    knownHosts: '/tmp/caul_known_hosts',
    localPackagePath: 'release/caul-arm64.deb',
    modelDir: '/home/parallels/.local/share/com.pais.handy/models/parakeet-tdt-0.6b-v3-int8',
    packageType: 'deb',
    platform: 'linux',
    releaseDir: '/home/parallels/caul-e2e/release',
    repoPath: '/home/parallels/caul-e2e/repo',
    stagedPackagePath: '/home/parallels/caul-e2e/release/caul-arm64.deb',
    user: 'parallels',
    vmName: 'Ubuntu 24.04.3 ARM64'
  }
};

const envNames = {
  backendPath: 'BACKEND_PATH',
  host: 'VM_SSH_HOST',
  knownHosts: 'VM_KNOWN_HOSTS',
  localPackagePath: 'LOCAL_PACKAGE_PATH',
  modelDir: 'PARAKEET_MODEL_DIR',
  releaseDir: 'RELEASE_DIR',
  repoPath: 'VM_REPO',
  stagedPackagePath: 'PACKAGE_PATH',
  user: 'VM_SSH_USER',
  vmName: 'VM_NAME'
};

export function listVmProfiles() {
  return Object.keys(profiles);
}

export function getVmProfile(profileName) {
  const profile = profiles[profileName];

  if (!profile) {
    throw new Error(`Unknown VM profile "${profileName}". Expected one of: ${listVmProfiles().join(', ')}`);
  }

  return structuredClone(profile);
}

export function resolveVmProfile(profileName, env = process.env) {
  const profile = getVmProfile(profileName);

  for (const [key, suffix] of Object.entries(envNames)) {
    const value = env[`${profile.envPrefix}_${suffix}`];

    if (value) {
      profile[key] = value;
    }
  }

  return profile;
}

export function getVmProfileFromArg(argv = process.argv) {
  const profileName = argv.find((arg) => !arg.startsWith('-') && listVmProfiles().includes(arg));

  if (!profileName) {
    return null;
  }

  return resolveVmProfile(profileName);
}
