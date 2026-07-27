const packageJson = require('./package.json');

const version = packageJson.version;
const isDevBuild = process.env.FORCE_DEV_BUILD === 'true';
const isPrivateDevBuild = isDevBuild && process.env.FORCE_DEV_PRIVATE_BUILD === 'true';
const isStableReleaseVersion = /^\d+\.\d+\.\d+$/.test(version);
const isBetaReleaseVersion = /^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(version);
if (!isDevBuild && !isStableReleaseVersion && !isBetaReleaseVersion) {
  throw new Error(`Release package version must be X.Y.Z or X.Y.Z-beta.N with N >= 1; received ${version}`);
}
const isBeta = !isDevBuild && (process.env.FORCE_BETA_BUILD === 'true' || isBetaReleaseVersion);
const buildChannel = isPrivateDevBuild ? 'DEV-PRIVATE' : isDevBuild ? 'DEV' : isBeta ? 'BETA' : 'STABLE';
const appDisplayName = isPrivateDevBuild ? 'Caul Dev-Private' : isDevBuild ? 'Caul Dev' : isBeta ? 'Caul Beta' : 'Caul';
const appId = isPrivateDevBuild ? 'dev.caul.app.dev-private' : isDevBuild ? 'dev.caul.app.dev' : isBeta ? 'dev.caul.app.beta' : 'dev.caul.app';
const artifactPrefix = isPrivateDevBuild ? 'Caul-Dev-Private' : isDevBuild ? 'Caul-Dev' : isBeta ? 'Caul-Beta' : 'Caul';
const devCodeSignIdentity = process.env.CAUL_DEV_CODESIGN_IDENTITY ?? 'Apple Development';
const packagePlatform = process.env.CAUL_PACKAGE_PLATFORM ?? process.platform;
const packageArch = process.env.CAUL_PACKAGE_ARCH;
const winArchitectures = packageArch ? [packageArch] : ['arm64'];
const linuxArchitectures = packageArch ? [packageArch] : ['arm64'];
const isWindowsArm64Package = ['win', 'win32'].includes(packagePlatform)
  && winArchitectures.length === 1
  && winArchitectures[0] === 'arm64';
const linuxArtifactArch = packageArch ?? '${arch}';
const backendTargetTriple = resolveBackendTargetTriple(packagePlatform, packageArch);

// The NSIS 7-Zip plug-in cannot restore entries encoded with the filter that
// modern 7-Zip automatically selects for ARM64 executables. BCJ remains fully
// reversible for arbitrary bytes and is supported by the bundled extractor.
if (isWindowsArm64Package) {
  process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ';
}

console.log(`\nCaul build configuration for v${version}`);
console.log(`  Type: ${buildChannel}`);
console.log(`  App ID: ${appId}`);
console.log(`  Product Name: ${appDisplayName}\n`);
if (isWindowsArm64Package) {
  console.log(`  NSIS 7-Zip Filter: ${process.env.ELECTRON_BUILDER_7Z_FILTER}\n`);
}
if (isDevBuild) {
  console.log(`  Dev Code Signing Identity: ${devCodeSignIdentity || 'ad-hoc'}\n`);
}

const iconPaths = {
  stable: {
    icns: 'assets/icons/icon.icns',
    ico: 'assets/icons/icon.ico',
    linux: 'assets/icons/linux'
  },
  beta: {
    icns: 'assets/icons/beta/icon.icns',
    ico: 'assets/icons/beta/icon.ico',
    linux: 'assets/icons/beta/linux'
  }
};
const icons = isBeta || isDevBuild ? iconPaths.beta : iconPaths.stable;
const backendBinaryName = packagePlatform === 'win' || packagePlatform === 'win32'
  ? 'caul-desktop-backend.exe'
  : 'caul-desktop-backend';
const backendReleaseDir = backendTargetTriple
  ? `target/${backendTargetTriple}/release`
  : 'target/release';
const macConfig = {
  artifactName: `${artifactPrefix}-macos-\${arch}.\${ext}`,
  category: 'public.app-category.productivity',
  entitlements: 'electron/CaulRelease.entitlements',
  entitlementsInherit: 'electron/CaulReleaseInherit.entitlements',
  extendInfo: {
    ...((!isDevBuild || isPrivateDevBuild) ? { LSUIElement: true } : {}),
    NSAudioCaptureUsageDescription: `${appDisplayName} needs access to system audio so it can transcribe audio playing on this Mac.`,
    NSMicrophoneUsageDescription: `${appDisplayName} needs microphone access when microphone listening is enabled.`,
    NSScreenCaptureUsageDescription: `${appDisplayName} needs screen and system audio recording access to capture call audio from this Mac.`
  },
  hardenedRuntime: !isDevBuild,
  icon: icons.icns,
  minimumSystemVersion: '14.0',
  ...(isDevBuild ? {
    identity: devCodeSignIdentity || null,
    timestamp: 'none'
  } : {
    identity: process.env.CSC_NAME || null,
    notarize: false
  }),
  target: [
    {
      target: isDevBuild ? 'dir' : 'zip',
      arch: ['arm64']
    }
  ]
};
const commonExtraResources = [
  {
    from: `${backendReleaseDir}/${backendBinaryName}`,
    to: `bin/${backendBinaryName}`
  },
  {
    from: 'scripts/run-pi-json.py',
    to: 'scripts/run-pi-json.py'
  }
];
const macExtraResources = [
  ...commonExtraResources,
  {
    from: 'native/macos-audio-helper/.build/release/CaulAudioHelper',
    to: 'bin/CaulAudioHelper'
  }
];

function resolveBackendTargetTriple(platform, arch) {
  const targetArch = arch ?? process.arch;
  const normalisedPlatform = platform === 'win' ? 'win32' : platform === 'mac' ? 'darwin' : platform;

  if (!arch && normalisedPlatform === process.platform) {
    return null;
  }

  if (normalisedPlatform === 'linux' && targetArch === 'arm64') {
    return 'aarch64-unknown-linux-gnu';
  }

  if (normalisedPlatform === 'linux' && targetArch === 'x64') {
    return 'x86_64-unknown-linux-gnu';
  }

  if (normalisedPlatform === 'win32' && targetArch === 'arm64') {
    return 'aarch64-pc-windows-msvc';
  }

  if (normalisedPlatform === 'win32' && targetArch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }

  return null;
}

module.exports = {
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/notarize-macos.cjs',
  appId,
  productName: appDisplayName,
  forceCodeSigning: process.env.CAUL_REQUIRE_RELEASE_SIGNING === 'true',
  ...(isPrivateDevBuild ? {
    extraMetadata: {
      name: 'caul-dev-private'
    }
  } : isDevBuild ? {
    extraMetadata: {
      name: 'caul-dev'
    }
  } : isBeta ? {
    extraMetadata: {
      name: 'caul-beta'
    }
  } : {}),
  directories: {
    output: isPrivateDevBuild ? 'release-dev-private' : isDevBuild ? 'release-dev' : 'release'
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'model-catalog.json',
    'package.json',
    'assets/icons/**/*'
  ],
  extraResources: packagePlatform === 'darwin' || packagePlatform === 'mac'
    ? macExtraResources
    : commonExtraResources,
  asar: true,
  publish: isDevBuild ? [] : [
    {
      provider: 'github',
      owner: 'apotenza92',
      repo: 'caul',
      ...(isBeta ? { channel: 'beta' } : {})
    }
  ],
  mac: macConfig,
  win: {
    artifactName: `${artifactPrefix}-windows-\${arch}-setup.\${ext}`,
    icon: icons.ico,
    target: [
      {
        target: 'nsis',
        arch: winArchitectures
      }
    ]
  },
  nsis: {
    include: 'build/installer.nsh',
    uninstallDisplayName: '${productName}'
  },
  linux: {
    artifactName: `caul${isBeta ? '-beta' : ''}-\${arch}.\${ext}`,
    category: 'Utility',
    icon: icons.linux,
    maintainer: 'Alex Potenza <apotenza92@users.noreply.github.com>',
    target: [
      {
        target: 'AppImage',
        arch: linuxArchitectures
      },
      {
        target: 'deb',
        arch: linuxArchitectures
      },
      {
        target: 'rpm',
        arch: linuxArchitectures
      }
    ]
  },
  rpm: {
    packageName: `caul${isBeta ? '-beta' : ''}`,
    artifactName: `caul${isBeta ? '-beta' : ''}-${linuxArtifactArch}.\${ext}`
  }
};
