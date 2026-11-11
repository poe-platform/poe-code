import { expect, it } from "vitest";
import { decodeImage } from "./codecs/index.js";

it("scales mixed TXT percentages to the header range before truncating", () => {
  const bytes = new TextEncoder().encode("# ImageMagick pixel enumeration: 1,1,0,255,srgba\n0,0: ( 12.5% ,127,100%,50%)\n");
  expect(decodeImage(bytes).data).toEqual(Uint8Array.of(31, 127, 255, 127));
});

it.each(["%", " % ", "50%%", "NaN%", "Infinity%", "100.1%"])("rejects invalid TXT percentage %s", value => {
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,255,srgb\n0,0: (${value},0,0)\n`);
  expect(() => decodeImage(bytes)).toThrow("Invalid TXT pixel");
});
