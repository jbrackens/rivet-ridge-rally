// Byte-exact gzip re-verification is only meaningful on the exact Node that
// produced the recorded streams: zlib output at the same level can differ
// between Node's bundled zlib builds (or zlib-ng linked distros), making a
// valid release fail comparison for an environmental reason. Fail fast with
// the real cause instead of surfacing a confusing byte mismatch.
export function assertGzipToolchainMatch(expectedNodeVersion, context) {
  if (typeof expectedNodeVersion !== "string" || expectedNodeVersion.length === 0) {
    throw new Error(`${context}: manifest Node toolchain identity is missing for gzip re-verification`);
  }
  if (process.versions.node !== expectedNodeVersion) {
    throw new Error(
      `${context}: gzip re-verification requires the manifest toolchain Node ${expectedNodeVersion} `
      + `(running ${process.versions.node}); differing zlib builds produce valid but byte-different streams`,
    );
  }
}
