if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('Susura macOS release packaging is supported only on Apple Silicon Macs.');
  console.error(`Current host: ${process.platform}/${process.arch}`);
  process.exit(1);
}
