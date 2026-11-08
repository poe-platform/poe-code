/** Shared PDF extraction mask semantics, independent of storage and traversal. */
export function applyImageMaskPixel(rgba: Uint8Array, offset: number, luminance: number,
  mode: "soft" | "explicit", matte?: readonly [number, number, number]): void {
  if (mode === "explicit") {
    if (luminance > 127) rgba[offset + 3] = 0;
    return;
  }
  if (matte && luminance > 0 && luminance < 255) {
    const alpha = luminance / 255;
    for (let channel = 0; channel < 3; channel++) {
      const background = matte[channel]!;
      rgba[offset + channel] = Math.max(0, Math.min(255, Math.round(background + (rgba[offset + channel]! - background) / alpha)));
    }
  }
  rgba[offset + 3] = luminance;
}
