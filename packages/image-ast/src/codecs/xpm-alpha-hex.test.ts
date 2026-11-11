import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";
import { readXpmFromSource } from "./xpm.js";

const xpm = (color: string): Uint8Array => new TextEncoder().encode(`/* XPM */\nstatic char *tile[] = {"1 1 1 1", "A c ${color}", "A"};`);

it.each(["#1230", "#11223300", "#123456789abc0000"])("keeps XPM hex alpha opaque in metadata: %s", async color => {
  const input = xpm(color);
  const metadata = { channels: 3, hasAlpha: false };
  expect(readImageMetadata(input)).toMatchObject(metadata);
  expect(decodeImage(input)).toMatchObject(metadata);
  const source = { size: input.length, async read(position: number, length: number) { return input.slice(position, position + length); } };
  expect(await readXpmFromSource(source, undefined, new AbortController().signal)).toMatchObject(metadata);
});

it.each(["#123g", "#112233gg", "#123456789abczzzz", "#12345", "#1234567", "#1234567890", "#12345678901234567890"])("rejects malformed XPM hex colors: %s", async color => {
  const input = xpm(color);
  expect(() => decodeImage(input)).toThrow("Invalid XPM color");
  const source = { size: input.length, async read(position: number, length: number) { return input.slice(position, position + length); } };
  await expect(readXpmFromSource(source, undefined, new AbortController().signal)).rejects.toThrow("Invalid XPM color");
});
