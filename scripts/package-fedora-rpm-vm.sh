#!/usr/bin/env bash
set -euo pipefail

cd /root/caul-rpm-build

rm -rf /tmp/caul-rpmbuild
mkdir -p \
  /tmp/caul-rpmbuild/BUILD \
  /tmp/caul-rpmbuild/BUILDROOT \
  /tmp/caul-rpmbuild/RPMS \
  /tmp/caul-rpmbuild/SOURCES \
  /tmp/caul-rpmbuild/SPECS \
  /tmp/caul-rpmbuild/SRPMS

tar -C release -czf /tmp/caul-rpmbuild/SOURCES/caul-linux-arm64-unpacked.tar.gz linux-arm64-unpacked
tar -C assets/icons -czf /tmp/caul-rpmbuild/SOURCES/caul-linux-icons.tar.gz linux

cat > /tmp/caul-rpmbuild/SOURCES/caul.desktop <<'EOF'
[Desktop Entry]
Name=Caul
Exec=/opt/Caul/caul %U
Terminal=false
Type=Application
Icon=caul
StartupWMClass=Caul
Comment=A private AI overlay for live calls and screen work.
Categories=Utility;
EOF

cat > /tmp/caul-rpmbuild/SPECS/caul.spec <<'EOF'
Name: caul
Version: 0.1.8
Release: 1%{?dist}
Summary: A private AI overlay for live calls and screen work.
License: MIT OR Apache-2.0
URL: https://github.com/apotenza92/caul#readme
BuildArch: aarch64
AutoReqProv: no

Requires: gtk3
Requires: libnotify
Requires: nss
Requires: libXScrnSaver
Requires: libXtst
Requires: xdg-utils
Requires: at-spi2-core
Requires: libuuid

Source0: caul-linux-arm64-unpacked.tar.gz
Source1: caul-linux-icons.tar.gz
Source2: caul.desktop

%description
A private AI overlay for live calls and screen work.

%prep

%build

%install
mkdir -p %{buildroot}/opt
tar -xzf %{SOURCE0} -C %{buildroot}/opt
mv %{buildroot}/opt/linux-arm64-unpacked %{buildroot}/opt/Caul

mkdir -p %{buildroot}/usr/share/applications
install -m 0644 %{SOURCE2} %{buildroot}/usr/share/applications/caul.desktop

mkdir -p %{buildroot}/usr/share/icons/hicolor
tar -xzf %{SOURCE1} -C %{_builddir}
for size in 16x16 22x22 24x24 32x32 48x48 64x64 72x72 96x96 128x128 256x256 512x512; do
  mkdir -p "%{buildroot}/usr/share/icons/hicolor/${size}/apps"
  install -m 0644 "%{_builddir}/linux/${size}.png" "%{buildroot}/usr/share/icons/hicolor/${size}/apps/caul.png"
done

%files
/opt/Caul
/usr/share/applications/caul.desktop
/usr/share/icons/hicolor/*/apps/caul.png

%changelog
* Wed Jun 03 2026 Alex Potenza <apotenza92@users.noreply.github.com> - 0.1.8-1
- Local release smoke build.
EOF

rpmbuild \
  -bb \
  --target aarch64 \
  --define "_topdir /tmp/caul-rpmbuild" \
  /tmp/caul-rpmbuild/SPECS/caul.spec

cp /tmp/caul-rpmbuild/RPMS/aarch64/caul-0.1.8-1*.aarch64.rpm /root/caul-rpm-build/release/caul-arm64.rpm
ls -lh /root/caul-rpm-build/release/caul-arm64.rpm
