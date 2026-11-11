import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";

const xpm = (...lines: string[]): Uint8Array => new TextEncoder().encode(`/* XPM */\nstatic char *icon[] = {${lines.map(line => JSON.stringify(line)).join(",")}};`);

// ImageMagick 7.1.2-35 uses gray only when no recognized palette field exists.
it.each([
  ["a", [190, 190, 190, 255]],
  ["a C red", [190, 190, 190, 255]],
  ["a c red", [255, 0, 0, 255]]
] as const)("decodes an XPM palette entry with optional fields: %s", (entry, pixel) => {
  const input = xpm("3 1 3 1", entry, "b c blue", ". c None", "ab.");
  expect(decodeImage(input).data).toEqual(Uint8Array.from([...pixel, 0, 0, 255, 255, 0, 0, 0, 0]));
  expect(readImageMetadata(input)).toMatchObject({ width: 3, height: 1, hasAlpha: true });
});

it("rejects an explicitly unknown XPM color instead of using gray", () => {
  const input = xpm("3 1 3 1", "a c no_such_named_color", "b c blue", ". c None", "ab.");
  expect(() => decodeImage(input)).toThrow("Invalid XPM color");
});
