// FFmpeg channel IDs leave bits 18–28 reserved. Keep masks as numbers without
// JavaScript bitwise operators, which truncate channels above bit 31.
export const audioSpeakerMasks: Record<string, number> = Object.fromEntries([
  ...["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR",
    "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"].map((name, bit) => [name, 2 ** bit]),
  ...["DL", "DR", "WL", "WR", "SDL", "SDR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR"]
    .map((name, bit) => [name, 2 ** (bit + 29)])
]);

export function parseAudioChannelCount(layout: string): number | undefined {
  const countText = layout.endsWith("C") ? layout.slice(0, -1)
    : layout.endsWith(" channels") ? layout.slice(0, -" channels".length) : "";
  if (countText.length && [...countText].every(digit => digit >= "0" && digit <= "9")) {
    const count = Number(countText);
    if (count > 0 && count <= 64) return count;
  }
  return undefined;
}

export function parseAudioChannelLayout(layout: string): string[] {
  if (layout === "mono" || layout === "1c") return ["FC"];
  if (layout === "stereo" || layout === "2c") return ["FL", "FR"];
  if (layout === "downmix") return ["DL", "DR"];
  if (layout === "2.1") return ["FL", "FR", "LFE"];
  if (layout === "3.0") return ["FL", "FR", "FC"];
  if (layout === "quad") return ["FL", "FR", "BL", "BR"];
  if (layout === "5.1" || layout === "6c") return ["FL", "FR", "FC", "LFE", "BL", "BR"];
  if (layout === "5.1(side)") return ["FL", "FR", "FC", "LFE", "SL", "SR"];
  if (layout === "7.1") return ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"];
  const hexadecimal = layout.toLowerCase().startsWith("0x") || layout.startsWith("0X");
  const digits = hexadecimal ? layout.slice(2) : layout;
  const alphabet = hexadecimal ? "0123456789abcdefABCDEF" : "0123456789";
  if (digits.length && [...digits].every(digit => alphabet.includes(digit))) {
    const mask = Number(layout);
    const names = Object.keys(audioSpeakerMasks).filter(name => Math.floor(mask / audioSpeakerMasks[name]!) % 2 === 1);
    if (Number.isSafeInteger(mask) && mask > 0 &&
        names.reduce((sum, name) => sum + audioSpeakerMasks[name]!, 0) === mask) return names;
  }
  return layout.split("+").map(channel => channel.split("@", 1)[0]!);
}
