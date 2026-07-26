export function unpackedDirectoryName(platform, arch) {
  if (platform === 'windows') {
    return arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`;
  }
  if (platform === 'linux') {
    return arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`;
  }
  throw new Error(`Unsupported native package platform: ${platform}`);
}
