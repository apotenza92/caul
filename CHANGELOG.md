# Changelog

All notable Caul changes are recorded here.

## [0.1.26]

- Added separate stable and beta identities for Apple Silicon macOS, Windows ARM64/x64, and Linux ARM64/x64 packages.
- Hardened hosted macOS releases with Developer ID signing, nested Rust and Swift helper verification, notarisation, stapling, Gatekeeper assessment, checksums, provenance, and native N-1 update tests.
- Added signed macOS automatic updates and explicit Windows/Linux package downloads that verify the selected asset against the versioned release SHA-256 manifest before revealing it to the user.
- Consolidated current release validation, repository instructions, generated icon sources, and deterministic renderer, Rust, helper, package, and updater coverage while removing obsolete plans and VM machinery.
- Aligned native Windows and Linux Rust target directories with the package layout expected by hosted release runners.
- Made the verifier’s Windows x64 and ARM64 unpacked-directory contract match Electron Builder’s platform naming.
- Made Windows packaged-launch gates wait for the GUI process and inspect its explicit exit code.
- Added an exact-tag legacy updater bootstrap so adversarial checks use the current testable updater while the valid 0.1.21-to-current transition is verified against the public release.
