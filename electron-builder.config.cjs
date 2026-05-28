const packageJson = require('./package.json');

const version = packageJson.version;
const isBeta = process.env.FORCE_BETA_BUILD === 'true'
  || version.includes('-alpha')
  || version.includes('-beta')
  || version.includes('-rc');
const appDisplayName = isBeta ? 'Susura Beta' : 'Susura';
const appId = isBeta ? 'dev.susura.app.beta' : 'dev.susura.app';
const artifactPrefix = isBeta ? 'Susura-Beta' : 'Susura';

console.log(`\nSusura build configuration for v${version}`);
console.log(`  Type: ${isBeta ? 'BETA' : 'STABLE'}`);
console.log(`  App ID: ${appId}`);
console.log(`  Product Name: ${appDisplayName}\n`);

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
const icons = isBeta ? iconPaths.beta : iconPaths.stable;

module.exports = {
  afterPack: './scripts/after-pack.cjs',
  appId,
  productName: appDisplayName,
  ...(isBeta ? {
    extraMetadata: {
      name: 'susura-beta'
    }
  } : {}),
  directories: {
    output: 'release'
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
    'assets/icons/**/*'
  ],
  extraResources: [
    {
      from: 'target/release/susura-desktop-backend',
      to: 'bin/susura-desktop-backend'
    },
    {
      from: 'native/macos-audio-helper/.build/release/SusuraAudioHelper',
      to: 'bin/SusuraAudioHelper'
    },
    {
      from: 'scripts/run-pi-json.py',
      to: 'scripts/run-pi-json.py'
    },
    {
      from: '.susura/pi-bundle/node_modules',
      to: 'pi/node_modules'
    }
  ],
  asar: true,
  compression: 'normal',
  publish: [
    {
      provider: 'github',
      owner: 'apotenza92',
      repo: 'susura',
      ...(isBeta ? { channel: 'beta' } : {})
    }
  ],
  mac: {
    artifactName: `${artifactPrefix}-macos-\${arch}.\${ext}`,
    category: 'public.app-category.productivity',
    entitlements: 'electron/SusuraRelease.entitlements',
    entitlementsInherit: 'electron/SusuraRelease.entitlements',
    extendInfo: {
      NSAudioCaptureUsageDescription: `${appDisplayName} needs access to system audio so it can transcribe audio playing on this Mac.`,
      NSMicrophoneUsageDescription: `${appDisplayName} needs microphone access when microphone listening is enabled.`,
      NSScreenCaptureUsageDescription: `${appDisplayName} needs screen and system audio recording access to capture call audio from this Mac.`
    },
    hardenedRuntime: true,
    icon: icons.icns,
    notarize: {
      teamId: '27JL2VERNC'
    },
    target: [
      {
        target: 'zip',
        arch: ['arm64']
      }
    ]
  },
  win: {
    artifactName: `${artifactPrefix}-windows-\${arch}-setup.\${ext}`,
    icon: icons.ico,
    target: []
  },
  linux: {
    artifactName: `susura${isBeta ? '-beta' : ''}-\${arch}.\${ext}`,
    category: 'Utility',
    icon: icons.linux,
    target: []
  }
};
