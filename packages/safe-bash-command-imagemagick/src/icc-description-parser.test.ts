import { expect, it } from "vitest";
import { readIccDescription } from "./icc-description.js";

function profile(type: "desc" | "mluc", text: string): Uint8Array {
  const encoded = type === "desc" ? new TextEncoder().encode(text + "\0")
    : Uint8Array.from(Array.from({ length: text.length }, (_, index) => [text.charCodeAt(index) >> 8, text.charCodeAt(index) & 255]).flat());
  const dataOffset = type === "desc" ? 12 : 28;
  const bytes = new Uint8Array(144 + dataOffset + encoded.length), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode("acsp"), 36);
  view.setUint32(128, 1);
  bytes.set(new TextEncoder().encode("desc"), 132);
  view.setUint32(136, 144);
  view.setUint32(140, bytes.length - 144);
  bytes.set(new TextEncoder().encode(type), 144);
  view.setUint32(152, type === "desc" ? encoded.length : 1);
  if (type === "mluc") {
    view.setUint32(156, 12);
    bytes.set(new TextEncoder().encode("enUS"), 160);
    view.setUint32(164, encoded.length);
    view.setUint32(168, 28);
  }
  bytes.set(encoded, 144 + dataOffset);
  return bytes;
}

it.each(["desc", "mluc"] as const)("reads the ICC %s description from a byte view", type => {
  const bytes = profile(type, type === "desc" ? "sRGB IEC61966-2.1" : "Profil été 日本語");
  const padded = new Uint8Array(bytes.length + 7);
  padded.set(bytes, 7);
  expect(readIccDescription(padded.subarray(7))).toBe(type === "desc" ? "sRGB IEC61966-2.1" : "Profil été 日本語");
});

it.each(["desc", "mluc"] as const)("ignores every truncated %s profile", type => {
  const bytes = profile(type, "sRGB");
  for (let length = 0; length < bytes.length; length++) expect(readIccDescription(bytes.subarray(0, length))).toBeUndefined();
});

it.each([
  [128, 0xffffffff], [136, 0xffffffff], [140, 0xffffffff],
  [152, 0xffffffff], [156, 0], [164, 0xffffffff], [168, 0xffffffff], [168, 0]
])("ignores malformed localized ICC field at %s", (offset, value) => {
  const bytes = profile("mluc", "sRGB");
  new DataView(bytes.buffer).setUint32(offset, value);
  expect(readIccDescription(bytes)).toBeUndefined();
});

it("ignores profiles without the description tag or with an unsupported tag type", () => {
  for (const offset of [132, 144]) {
    const bytes = profile("desc", "sRGB");
    bytes.set(new TextEncoder().encode("text"), offset);
    expect(readIccDescription(bytes)).toBeUndefined();
  }
});

it.each([
  { locales: ["frFR", "enGB", "enUS"], expected: "US" },
  { locales: ["frFR", "enGB", "deDE"], expected: "GB" },
  { locales: ["frFR", "deDE", "esES"], expected: "FR" }
])("selects the ImageMagick description locale from $locales", ({ locales, expected }) => {
  const bytes = new Uint8Array(208), view = new DataView(bytes.buffer);
  bytes.set(profile("mluc", "FR").subarray(0, 160));
  view.setUint32(0, bytes.length);
  view.setUint32(140, 64);
  view.setUint32(152, 3);
  locales.forEach((locale, index) => {
    const entry = 160 + index * 12;
    bytes.set(new TextEncoder().encode(locale), entry);
    view.setUint32(entry + 4, 4);
    view.setUint32(entry + 8, 52 + index * 4);
    bytes.set([0, locale.charCodeAt(2), 0, locale.charCodeAt(3)], 196 + index * 4);
  });
  expect(readIccDescription(bytes)).toBe(expected);
});
