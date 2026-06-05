const packageJson = require('./package.json');

const version = packageJson.version;
const isDevBuild = process.env.FORCE_DEV_BUILD === 'true';
const isPrivateDevBuild = isDevBuild && process.env.FORCE_DEV_PRIVATE_BUILD === 'true';
const isBeta = !isDevBuild && (process.env.FORCE_BETA_BUILD === 'true'
  || version.includes('-alpha')
  || version.includes('-beta')
  || version.includes('-rc'));
const buildChannel = isPrivateDevBuild ? 'DEV-PRIVATE' : isDevBuild ? 'DEV' : isBeta ? 'BETA' : 'STABLE';
const appDisplayName = isPrivateDevBuild ? 'Caul Dev-Private' : isDevBuild ? 'Caul Dev' : isBeta ? 'Caul Beta' : 'Caul';
const appId = isPrivateDevBuild ? 'dev.caul.app.dev-private' : isDevBuild ? 'dev.caul.app.dev' : isBeta ? 'dev.caul.app.beta' : 'dev.caul.app';
const artifactPrefix = isPrivateDevBuild ? 'Caul-Dev-Private' : isDevBuild ? 'Caul-Dev' : isBeta ? 'Caul-Beta' : 'Caul';
const devCodeSignIdentity = process.env.CAUL_DEV_CODESIGN_IDENTITY
  ?? '0A2CD8B7803C6E7A4907B7CA517538115CA1A660';
const packagePlatform = process.env.CAUL_PACKAGE_PLATFORM ?? process.platform;
const packageArch = process.env.CAUL_PACKAGE_ARCH;
const winArchitectures = packageArch ? [packageArch] : ['arm64'];
const linuxArchitectures = packageArch ? [packageArch] : ['arm64'];
const linuxArtifactArch = packageArch ?? '${arch}';

console.log(`\nCaul build configuration for v${version}`);
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
  ? 'caul-desktop-backend.exe'
  : 'caul-desktop-backend';
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
    from: 'native/macos-audio-helper/.build/release/CaulAudioHelper',
    to: 'bin/CaulAudioHelper'
  }
];

module.exports = {
  afterPack: './scripts/after-pack.cjs',
  appId,
  productName: appDisplayName,
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
