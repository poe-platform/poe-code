// FFmpeg channel IDs leave bits 18–28 reserved. Keep masks as numbers without
// JavaScript bitwise operators, which truncate channels above bit 31.
export const audioSpeakerMasks: Record<string, number> = Object.fromEntries([
  ...["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR",
    "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"].map((name, bit) => [name, 2 ** bit]),
  ...["DL", "DR", "WL", "WR", "SDL", "SDR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR"]
    .map((name, bit) => [name, 2 ** (bit + 29)])
]);

export function parseAudioChannelLayout(layout: string): string[] {
  if (layout === "mono" || layout === "1c") return ["FC"];
  if (layout === "stereo" || layout === "2c") return ["FL", "FR"];
  if (layout === "3.0") return ["FL", "FR", "FC"];
  if (layout === "quad") return ["FL", "FR", "BL", "BR"];
  if (layout === "5.1" || layout === "6c") return ["FL", "FR", "FC", "LFE", "BL", "BR"];
  const digits = layout.startsWith("0x") ? layout.slice(2) : layout;
  const alphabet = layout.startsWith("0x") ? "0123456789abcdefABCDEF" : "0123456789";
  if (digits.length && [...digits].every(digit => alphabet.includes(digit))) {
    const mask = Number(layout);
    const names = Object.keys(audioSpeakerMasks).filter(name => Math.floor(mask / audioSpeakerMasks[name]!) % 2 === 1);
    if (Number.isSafeInteger(mask) && mask > 0 &&
        names.reduce((sum, name) => sum + audioSpeakerMasks[name]!, 0) === mask) return names;
  }
  return layout.split("+");
}
