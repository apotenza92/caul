#!/bin/bash

# RPM passes the number of matching packages left after this transaction.
# During an upgrade the replacement is already installed, so its links and
# AppArmor profile must remain intact. A final uninstall passes zero.
if [[ "${1:-0}" -gt 0 ]]; then
  exit 0
fi

if type update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
  rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

if [[ -f "$APPARMOR_PROFILE_DEST" ]]; then
  if apparmor_status --enabled >/dev/null 2>&1; then
    if ! { [[ -x /usr/bin/ischroot ]] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
