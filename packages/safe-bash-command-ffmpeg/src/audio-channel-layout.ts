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
    if (mask === 1) return ["FL"];
    if (mask === 2) return ["FR"];
    if (mask === 3) return ["FL", "FR"];
  }
  return layout.split("+");
}
