const packageJson = require('./package.json');

const version = packageJson.version;
const isDevBuild = process.env.FORCE_DEV_BUILD === 'true';
const isBeta = !isDevBuild && (process.env.FORCE_BETA_BUILD === 'true'
  || version.includes('-alpha')
  || version.includes('-beta')
  || version.includes('-rc'));
const buildChannel = isDevBuild ? 'DEV' : isBeta ? 'BETA' : 'STABLE';
const appDisplayName = isDevBuild ? 'Susura Dev' : isBeta ? 'Susura Beta' : 'Susura';
const appId = isDevBuild ? 'dev.susura.app.dev' : isBeta ? 'dev.susura.app.beta' : 'dev.susura.app';
const artifactPrefix = isDevBuild ? 'Susura-Dev' : isBeta ? 'Susura-Beta' : 'Susura';
const devCodeSignIdentity = process.env.SUSURA_DEV_CODESIGN_IDENTITY
  ?? '0A2CD8B7803C6E7A4907B7CA517538115CA1A660';
const packagePlatform = process.env.SUSURA_PACKAGE_PLATFORM ?? process.platform;
const packageArch = process.env.SUSURA_PACKAGE_ARCH;
const winArchitectures = packageArch ? [packageArch] : ['arm64'];
const linuxArchitectures = packageArch ? [packageArch] : ['arm64'];
const linuxArtifactArch = packageArch ?? '${arch}';

console.log(`\nSusura build configuration for v${version}`);
console.log(`  Type: ${buildChannel}`);
console.log(`  App ID: ${appId}`);
console.log(`  Product Name: ${appDisplayName}\n`);
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
  ? 'susura-desktop-backend.exe'
  : 'susura-desktop-backend';
const macConfig = {
  artifactName: `${artifactPrefix}-macos-\${arch}.\${ext}`,
  category: 'public.app-category.productivity',
  entitlements: 'electron/SusuraRelease.entitlements',
  entitlementsInherit: 'electron/SusuraReleaseInherit.entitlements',
  extendInfo: {
    ...(isDevBuild ? {} : { LSUIElement: true }),
    NSAudioCaptureUsageDescription: `${appDisplayName} needs access to system audio so it can transcribe audio playing on this Mac.`,
    NSMicrophoneUsageDescription: `${appDisplayName} needs microphone access when microphone listening is enabled.`,
    NSScreenCaptureUsageDescription: `${appDisplayName} needs screen and system audio recording access to capture call audio from this Mac.`
  },
  hardenedRuntime: !isDevBuild,
  icon: icons.icns,
  ...(isDevBuild ? {
    identity: devCodeSignIdentity || null,
    timestamp: 'none'
  } : {
    notarize: {
      teamId: '27JL2VERNC'
    }
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
    from: `target/release/${backendBinaryName}`,
    to: `bin/${backendBinaryName}`
  },
  {
    from: 'scripts/run-pi-json.py',
    to: 'scripts/run-pi-json.py'
  },
  {
    from: 'node_modules/@earendil-works/pi-coding-agent',
    to: 'pi/node_modules/@earendil-works/pi-coding-agent'
  }
];
const macExtraResources = [
  ...commonExtraResources,
  {
    from: 'native/macos-audio-helper/.build/release/SusuraAudioHelper',
    to: 'bin/SusuraAudioHelper'
  }
];

module.exports = {
  afterPack: './scripts/after-pack.cjs',
  appId,
  productName: appDisplayName,
  ...(isDevBuild ? {
    extraMetadata: {
      name: 'susura-dev'
    }
  } : isBeta ? {
    extraMetadata: {
      name: 'susura-beta'
    }
  } : {}),
  directories: {
    output: isDevBuild ? 'release-dev' : 'release'
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
    'assets/icons/**/*'
  ],
  extraResources: packagePlatform === 'darwin' || packagePlatform === 'mac'
    ? macExtraResources
    : commonExtraResources,
  asar: true,
  compression: 'normal',
  publish: isDevBuild ? [] : [
    {
      provider: 'github',
      owner: 'apotenza92',
      repo: 'susura',
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
  linux: {
    artifactName: `susura${isBeta ? '-beta' : ''}-\${arch}.\${ext}`,
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
    packageName: `susura${isBeta ? '-beta' : ''}`,
    artifactName: `susura${isBeta ? '-beta' : ''}-${linuxArtifactArch}.\${ext}`
  }
};
