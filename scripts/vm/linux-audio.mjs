export const linuxSilentSinkName = 'caul_vm_silent_sink';

function pipeWireSilentSinkIdCommand() {
  return `pw-cli ls Node 2>/dev/null | awk '/^[[:space:]]*id / { gsub(",", "", $2); id=$2 } /node.name = "${linuxSilentSinkName}"/ { print id; exit }'`;
}

function wirePlumberSinkIdsCommand() {
  return `wpctl status 2>/dev/null | awk '/Sinks:/ { in_sinks=1; next } /Sink endpoints:|Sources:/ { in_sinks=0 } in_sinks && match($0, /[0-9]+\\./) { print substr($0, RSTART, RLENGTH - 1) }'`;
}

export function linuxSilentAudioSetupCommand() {
  return [
    'set +e',
    'if command -v pactl >/dev/null 2>&1; then',
    `  pactl load-module module-null-sink sink_name=${linuxSilentSinkName} sink_properties=device.description=CaulVMSilentSink >/dev/null 2>&1 || true`,
    `  pactl set-default-sink ${linuxSilentSinkName} >/dev/null 2>&1 || true`,
    '  pactl list short sinks | while read -r sink name rest; do',
    `    if [ "$name" = "${linuxSilentSinkName}" ]; then`,
    '      pactl set-sink-mute "$sink" 0 >/dev/null 2>&1 || true',
    '      pactl set-sink-volume "$sink" 70% >/dev/null 2>&1 || true',
    '    else',
    '      pactl set-sink-mute "$sink" 1 >/dev/null 2>&1 || true',
    '      pactl set-sink-volume "$sink" 0% >/dev/null 2>&1 || true',
    '    fi',
    '  done',
    'fi',
    'if ! command -v pactl >/dev/null 2>&1 && command -v pw-cli >/dev/null 2>&1 && command -v wpctl >/dev/null 2>&1; then',
    `  silent_id="$(${pipeWireSilentSinkIdCommand()})"`,
    '  if [ -z "$silent_id" ]; then',
    `    pw-cli create-node adapter '{ factory.name=support.null-audio-sink node.name=${linuxSilentSinkName} media.class=Audio/Sink object.linger=true audio.position=[FL FR] }' >/dev/null 2>&1 || true`,
    `    silent_id="$(${pipeWireSilentSinkIdCommand()})"`,
    '  fi',
    '  if [ -n "$silent_id" ]; then',
    '    wpctl set-default "$silent_id" >/dev/null 2>&1 || true',
    '    wpctl set-mute "$silent_id" 0 >/dev/null 2>&1 || true',
    '    wpctl set-volume "$silent_id" 0.70 >/dev/null 2>&1 || true',
    `    ${wirePlumberSinkIdsCommand()} | while read -r sink; do`,
    '      [ -z "$sink" ] && continue',
    '      if [ "$sink" != "$silent_id" ]; then',
    '        wpctl set-mute "$sink" 1 >/dev/null 2>&1 || true',
    '        wpctl set-volume "$sink" 0 >/dev/null 2>&1 || true',
    '      fi',
    '    done',
    '  fi',
    'fi',
    `if command -v wpctl >/dev/null 2>&1 && command -v pactl >/dev/null 2>&1 && [ "$(pactl get-default-sink 2>/dev/null)" = "${linuxSilentSinkName}" ]; then`,
    '  wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 >/dev/null 2>&1 || true',
    '  wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.70 >/dev/null 2>&1 || true',
    `elif command -v wpctl >/dev/null 2>&1 && ! command -v pactl >/dev/null 2>&1 && [ -n "$(${pipeWireSilentSinkIdCommand()})" ]; then`,
    '  true',
    'elif command -v wpctl >/dev/null 2>&1; then',
    '  wpctl set-mute @DEFAULT_AUDIO_SINK@ 1 >/dev/null 2>&1 || true',
    '  wpctl set-volume @DEFAULT_AUDIO_SINK@ 0 >/dev/null 2>&1 || true',
    'fi',
    'set -e'
  ].join('\n');
}

export function linuxSilentAudioVerificationCommand() {
  return [
    'if command -v pactl >/dev/null 2>&1; then',
    `  pactl get-default-sink | grep -qx ${linuxSilentSinkName}`,
    `  pactl list short sinks | awk '$2 != "${linuxSilentSinkName}" { print $1 }' | while read -r sink; do`,
    '    [ -z "$sink" ] && continue',
    '    pactl get-sink-mute "$sink" | grep -qi "yes"',
    '  done',
    'elif command -v pw-cli >/dev/null 2>&1 && command -v wpctl >/dev/null 2>&1; then',
    `  silent_id="$(${pipeWireSilentSinkIdCommand()})"`,
    '  [ -n "$silent_id" ]',
    `  wpctl status 2>/dev/null | awk -v id="$silent_id" '/Sinks:/ { in_sinks=1; next } /Sink endpoints:|Sources:/ { in_sinks=0 } in_sinks && /\\*/ && $0 ~ id "\\\\." { found=1 } END { exit found ? 0 : 1 }'`,
    `  ${wirePlumberSinkIdsCommand()} | while read -r sink; do`,
    '    [ -z "$sink" ] && continue',
    '    [ "$sink" = "$silent_id" ] && continue',
    '    wpctl get-volume "$sink" | grep -qi "MUTED"',
    '  done',
    'else',
    '  exit 1',
    'fi'
  ].join('\n');
}

export function linuxSilentAudioStatusCommand() {
  return [
    'echo "default-sink=$(pactl get-default-sink 2>/dev/null || true)"',
    'pactl list short sinks 2>/dev/null || true',
    `echo "silent-pipewire-sink-id=$(${pipeWireSilentSinkIdCommand()})"`,
    'wpctl status 2>/dev/null || true',
    'wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null || true'
  ].join('\n');
}
