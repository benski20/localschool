#!/usr/bin/env bash
# Builds the call-audio helper (CallAudio.swift, ScreenCaptureKit, macOS 13+) as one universal
# binary and puts it where Tauri's `bundle.externalBin` ("bin/td-call-audio") looks for it:
#   desktop/src-tauri/bin/td-call-audio-<target triple>
# A universal app build needs three names: the bundler uses -universal-apple-darwin and the
# two per-architecture cargo builds check -aarch64-apple-darwin / -x86_64-apple-darwin. All
# three are the same universal file. CI runs this before `cargo test` and `tauri build`;
# build.rs runs it on a Mac when the binary is missing.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/../src-tauri/bin"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -parse-as-library \
    -target "$arch-apple-macos13" \
    -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia \
    "$here/CallAudio.swift" -o "$work/td-call-audio-$arch"
done
lipo -create "$work/td-call-audio-arm64" "$work/td-call-audio-x86_64" -output "$work/td-call-audio"

mkdir -p "$bin"
for triple in universal-apple-darwin aarch64-apple-darwin x86_64-apple-darwin; do
  cp "$work/td-call-audio" "$bin/td-call-audio-$triple"
  chmod 755 "$bin/td-call-audio-$triple"
done
echo "td-call-audio: $(lipo -archs "$bin/td-call-audio-universal-apple-darwin")"
