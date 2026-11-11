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
  if (layout === "2.1" || layout === "3c") return ["FL", "FR", "LFE"];
  if (layout === "3.0") return ["FL", "FR", "FC"];
  if (layout === "4.0" || layout === "4c") return ["FL", "FR", "FC", "BC"];
  if (layout === "4.1") return ["FL", "FR", "FC", "LFE", "BC"];
  if (layout === "quad") return ["FL", "FR", "BL", "BR"];
  if (layout === "5.0" || layout === "5c") return ["FL", "FR", "FC", "BL", "BR"];
  if (layout === "5.0(side)") return ["FL", "FR", "FC", "SL", "SR"];
  if (layout === "5.1" || layout === "6c") return ["FL", "FR", "FC", "LFE", "BL", "BR"];
  if (layout === "5.1(side)") return ["FL", "FR", "FC", "LFE", "SL", "SR"];
  if (layout === "6.1" || layout === "7c") return ["FL", "FR", "FC", "LFE", "BC", "SL", "SR"];
  if (layout === "octagonal") return ["FL", "FR", "FC", "BL", "BR", "BC", "SL", "SR"];
  if (layout === "7.1" || layout === "8c") return ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"];
  if (layout === "3.0(back)") return ["FL", "FR", "BC"];
  if (layout === "3.1") return ["FL", "FR", "FC", "LFE"];
  if (layout === "3.1.2") return ["FL", "FR", "FC", "LFE", "TFL", "TFR"];
  if (layout === "quad(side)") return ["FL", "FR", "SL", "SR"];
  if (layout === "5.1.2") return ["FL", "FR", "FC", "LFE", "BL", "BR", "TFL", "TFR"];
  if (layout === "5.1.4") return ["FL", "FR", "FC", "LFE", "BL", "BR", "TFL", "TFR", "TBL", "TBR"];
  if (layout === "6.0") return ["FL", "FR", "FC", "BC", "SL", "SR"];
  if (layout === "6.0(front)") return ["FL", "FR", "FLC", "FRC", "SL", "SR"];
  if (layout === "hexagonal") return ["FL", "FR", "FC", "BL", "BR", "BC"];
  if (layout === "6.1(back)") return ["FL", "FR", "FC", "LFE", "BL", "BR", "BC"];
  if (layout === "6.1(front)") return ["FL", "FR", "LFE", "FLC", "FRC", "SL", "SR"];
  if (layout === "7.0") return ["FL", "FR", "FC", "BL", "BR", "SL", "SR"];
  if (layout === "7.0(front)") return ["FL", "FR", "FC", "FLC", "FRC", "SL", "SR"];
  if (layout === "7.1(wide)") return ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC"];
  if (layout === "7.1(wide-side)") return ["FL", "FR", "FC", "LFE", "FLC", "FRC", "SL", "SR"];
  if (layout === "7.1.2") return ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR", "TFL", "TFR"];
  if (layout === "7.1.4") return ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR", "TFL", "TFR", "TBL", "TBR"];
  if (layout === "7.2.3") return ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR", "TFL", "TFR", "TBC", "LFE2"];
  if (layout === "9.1.4") return ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "SL", "SR", "TFL", "TFR", "TBL", "TBR"];
  if (layout === "cube") return ["FL", "FR", "BL", "BR", "TFL", "TFR", "TBL", "TBR"];
  if (layout === "hexadecagonal") return ["FL", "FR", "FC", "BL", "BR", "BC", "SL", "SR",
    "TFL", "TFC", "TFR", "TBL", "TBC", "TBR", "WL", "WR"];
  if (layout === "22.2") return ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC",
    "TFL", "TFC", "TFR", "TBL", "TBC", "TBR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR"];
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
