# Changelog

All notable Caul changes are recorded here.

## [0.1.28]

- Added separate stable and beta identities for Apple Silicon macOS, Windows ARM64/x64, and Linux ARM64/x64 packages.
- Hardened hosted macOS releases with Developer ID signing, nested Rust and Swift helper verification, notarisation, stapling, Gatekeeper assessment, checksums, provenance, and native N-1 update tests.
- Added signed macOS automatic updates and explicit Windows/Linux package downloads that verify the selected asset against the versioned release SHA-256 manifest before revealing it to the user.
- Consolidated current release validation, repository instructions, generated icon sources, and deterministic renderer, Rust, helper, package, and updater coverage while removing obsolete plans and VM machinery.
- Aligned native Windows and Linux Rust target directories with the package layout expected by hosted release runners.
- Made the verifier’s Windows x64 and ARM64 unpacked-directory contract match Electron Builder’s platform naming.
- Made Windows packaged-launch gates wait for the GUI process and inspect its explicit exit code.
- Added an exact-tag legacy updater bootstrap so adversarial checks use the current testable updater while the valid 0.1.21-to-current transition is verified against the public release.
- Made native package launch verification require explicit packaged-app success output while tolerating the Windows ARM64 runner’s post-success Electron exit timeout.
- Made adversarial macOS updater gates observe checksum rejection and verify that the trusted app survives or relaunches after signature rejection.
- Made hosted NSIS verification wait for Windows ARM64 installations and removals to settle, resolve installed files within the isolated install root, and report its contents on failure.
