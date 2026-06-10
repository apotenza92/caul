#!/usr/bin/env node
import { resolveVmProfile, listVmProfiles } from './vm/profiles.mjs';
import { createPowerShellEncodedArgs, getSshArgs, macGuestShellArgs, runCommand, runPrlctl, shellQuote } from './vm/commands.mjs';
import {
  linuxSilentAudioSetupCommand,
  linuxSilentAudioStatusCommand,
  linuxSilentAudioVerificationCommand
} from './vm/linux-audio.mjs';

const profileName = process.argv[2];

if (process.argv.includes('--help') || !profileName) {
  console.log(`Usage: node scripts/vm-prepare.mjs <${listVmProfiles().join('|')}>`);
  console.log('Verifies the VM is running, mutes audio, stops stale Caul processes, and checks staged fixture paths.');
  process.exit(profileName ? 0 : 1);
}

const profile = resolveVmProfile(profileName);

await ensureVmReady(profile);
await muteVm(profile);
await stopStaleCaul(profile);
await checkDiskSpace(profile);
await checkModelFixture(profile);

console.log(`caul-vm-prepare ${JSON.stringify({
  ok: true,
  modelDir: profile.modelDir,
  profile: profile.platform,
  releaseDir: profile.releaseDir,
  repoPath: profile.repoPath,
  vmName: profile.vmName
})}`);

async function ensureVmReady(profile) {
  const info = await runPrlctl(['list', profile.vmName, '-i'], { timeout: 15_000 });

  if (!info.ok || !info.text.includes('State: running')) {
    const started = await runPrlctl(['start', profile.vmName], { timeout: 60_000 });

    if (!started.ok && !started.text.includes('already')) {
      throw new Error(`Could not start VM "${profile.vmName}": ${started.text || info.text}`);
    }
  }
}

async function muteVm(profile) {
  if (profile.platform === 'macos') {
    await runPrlctl([
      'exec',
      profile.vmName,
      ...macGuestShellArgs("osascript -e 'set volume output muted true' -e 'set volume output volume 0'")
    ], { timeout: 15_000 });
    return;
  }

  if (profile.platform === 'linux') {
    const mute = await runCommand('ssh', getSshArgs(profile, [
      linuxSilentAudioSetupCommand(),
      linuxSilentAudioVerificationCommand(),
      linuxSilentAudioStatusCommand()
    ].join('\n')), { timeout: 15_000 });

    if (!mute.ok) {
      throw new Error(`Could not route Linux VM audio to the silent test sink: ${mute.text}`);
    }

    return;
  }

  if (profile.platform === 'win') {
    const script = [
      '$signature = \'[DllImport("winmm.dll")] public static extern int waveOutSetVolume(System.IntPtr hwo, uint dwVolume);\'',
      'Add-Type -Namespace Caul -Name VmAudio -MemberDefinition $signature',
      '[Caul.VmAudio]::waveOutSetVolume([IntPtr]::Zero, 0) | Out-Null'
    ].join('\n');
    await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs(script)], { timeout: 15_000 });
  }
}

async function stopStaleCaul(profile) {
  if (profile.platform === 'macos') {
    await runPrlctl(['exec', profile.vmName, ...macGuestShellArgs('pkill -x Caul >/dev/null 2>&1 || true')], { timeout: 10_000 });
  } else if (profile.platform === 'linux') {
    await runCommand('ssh', getSshArgs(profile, "pkill -f '/opt/Caul/caul|caul-desktop-backend' >/dev/null 2>&1 || true"), { timeout: 10_000 });
  } else if (profile.platform === 'win') {
    await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs("Get-Process Caul,caul-desktop-backend -ErrorAction SilentlyContinue | Stop-Process -Force")], { timeout: 10_000 });
  }
}

async function checkDiskSpace(profile) {
  if (profile.platform === 'win') {
    const result = await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs("(Get-PSDrive C).Free")], { timeout: 10_000 });
    if (!result.ok) throw new Error(`Could not inspect Windows disk space: ${result.text}`);
    return;
  }

  const command = profile.platform === 'macos'
    ? ['prlctl', ['exec', profile.vmName, ...macGuestShellArgs(`df -Pk ${shellQuote(profile.releaseDir)} 2>/dev/null || df -Pk /Users/alex`)]]
    : ['ssh', getSshArgs(profile, `df -Pk ${shellQuote(profile.releaseDir)} 2>/dev/null || df -Pk /home/parallels`)];
  const result = await runCommand(command[0], command[1], { timeout: 10_000 });
  if (!result.ok) throw new Error(`Could not inspect ${profile.platform} disk space: ${result.text}`);
}

async function checkModelFixture(profile) {
  if (profile.platform === 'win') {
    const result = await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs(`if (!(Test-Path ${JSON.stringify(profile.modelDir)})) { Write-Output 'model-fixture-missing'; exit 2 }`)], { timeout: 10_000 });
    if (!result.ok || result.text.includes('model-fixture-missing')) {
      throw new Error(`Missing Windows model fixture: ${profile.modelDir}`);
    }
    return;
  }

  const command = profile.platform === 'macos'
    ? ['prlctl', ['exec', profile.vmName, ...macGuestShellArgs(`test -d ${shellQuote(profile.modelDir)} || echo model-fixture-missing`)]]
    : ['ssh', getSshArgs(profile, `test -d ${shellQuote(profile.modelDir)} || echo model-fixture-missing`)];
  const result = await runCommand(command[0], command[1], { timeout: 10_000 });
  if (!result.ok || result.text.includes('model-fixture-missing')) {
    throw new Error(`Missing ${profile.platform} model fixture: ${profile.modelDir}`);
  }
}
