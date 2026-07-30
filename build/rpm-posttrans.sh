#!/bin/bash

# RPM installs the replacement package before running the old package's
# post-uninstall script. Older Caul packages remove the command link and
# AppArmor profile at that late point, so restore integration only for product
# variants that remain registered after the complete transaction.
restore_product_integration() {
  local executable="$1"
  local product_directory="$2"
  local application_path="/opt/$product_directory/$executable"
  local profile_source="/opt/$product_directory/resources/apparmor-profile"
  local profile_target="/etc/apparmor.d/$executable"

  rpm -q "$executable" >/dev/null 2>&1 || return 0
  [[ -x "$application_path" ]] || return 0

  if type update-alternatives >/dev/null 2>&1; then
    if [[ -L "/usr/bin/$executable" \
      && -e "/usr/bin/$executable" \
      && "$(readlink "/usr/bin/$executable")" != "/etc/alternatives/$executable" ]]; then
      rm -f "/usr/bin/$executable"
    fi
    update-alternatives \
      --install "/usr/bin/$executable" "$executable" "$application_path" 100 \
      || ln -sf "$application_path" "/usr/bin/$executable"
  else
    ln -sf "$application_path" "/usr/bin/$executable"
  fi

  if [[ -f "$profile_source" ]] && apparmor_status --enabled >/dev/null 2>&1; then
    if apparmor_parser --skip-kernel-load --debug "$profile_source" >/dev/null 2>&1; then
      cp -f "$profile_source" "$profile_target"
      if ! { [[ -x /usr/bin/ischroot ]] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
        apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"
      fi
    fi
  fi
}

restore_product_integration caul Caul
restore_product_integration caul-beta 'Caul Beta'

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
