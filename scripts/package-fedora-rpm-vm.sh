#!/usr/bin/env bash
set -euo pipefail

cd /root/susura-rpm-build

rm -rf /tmp/susura-rpmbuild
mkdir -p \
  /tmp/susura-rpmbuild/BUILD \
  /tmp/susura-rpmbuild/BUILDROOT \
  /tmp/susura-rpmbuild/RPMS \
  /tmp/susura-rpmbuild/SOURCES \
  /tmp/susura-rpmbuild/SPECS \
  /tmp/susura-rpmbuild/SRPMS

tar -C release -czf /tmp/susura-rpmbuild/SOURCES/susura-linux-arm64-unpacked.tar.gz linux-arm64-unpacked
tar -C assets/icons -czf /tmp/susura-rpmbuild/SOURCES/susura-linux-icons.tar.gz linux

cat > /tmp/susura-rpmbuild/SOURCES/susura.desktop <<'EOF'
[Desktop Entry]
Name=Susura
Exec=/opt/Susura/susura %U
Terminal=false
Type=Application
Icon=susura
StartupWMClass=Susura
Comment=A private AI overlay for live calls and screen work.
Categories=Utility;
EOF

cat > /tmp/susura-rpmbuild/SPECS/susura.spec <<'EOF'
Name: susura
Version: 0.1.7
Release: 1%{?dist}
Summary: A private AI overlay for live calls and screen work.
License: MIT OR Apache-2.0
URL: https://github.com/apotenza92/susura#readme
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

Source0: susura-linux-arm64-unpacked.tar.gz
Source1: susura-linux-icons.tar.gz
Source2: susura.desktop

%description
A private AI overlay for live calls and screen work.

%prep

%build

%install
mkdir -p %{buildroot}/opt
tar -xzf %{SOURCE0} -C %{buildroot}/opt
mv %{buildroot}/opt/linux-arm64-unpacked %{buildroot}/opt/Susura

mkdir -p %{buildroot}/usr/share/applications
install -m 0644 %{SOURCE2} %{buildroot}/usr/share/applications/susura.desktop

mkdir -p %{buildroot}/usr/share/icons/hicolor
tar -xzf %{SOURCE1} -C %{_builddir}
for size in 16x16 22x22 24x24 32x32 48x48 64x64 72x72 96x96 128x128 256x256 512x512; do
  mkdir -p "%{buildroot}/usr/share/icons/hicolor/${size}/apps"
  install -m 0644 "%{_builddir}/linux/${size}.png" "%{buildroot}/usr/share/icons/hicolor/${size}/apps/susura.png"
done

%files
/opt/Susura
/usr/share/applications/susura.desktop
/usr/share/icons/hicolor/*/apps/susura.png

%changelog
* Wed Jun 03 2026 Alex Potenza <apotenza92@users.noreply.github.com> - 0.1.7-1
- Local release smoke build.
EOF

rpmbuild \
  -bb \
  --target aarch64 \
  --define "_topdir /tmp/susura-rpmbuild" \
  /tmp/susura-rpmbuild/SPECS/susura.spec

cp /tmp/susura-rpmbuild/RPMS/aarch64/susura-0.1.7-1*.aarch64.rpm /root/susura-rpm-build/release/susura-arm64.rpm
ls -lh /root/susura-rpm-build/release/susura-arm64.rpm
