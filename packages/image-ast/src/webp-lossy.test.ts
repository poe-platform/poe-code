import { expect, it } from "vitest";
import sharp from "./index.js";
import { decodeWebpToStorage } from "./codecs/webp-input-storage.js";
import { decodeWebpImage } from "./codecs/webp.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import webpFixtures from "../../../tests/fixtures/media/webp-fixtures.json";

// Fixtures: native magick encodes a 64x48 grid with RGB =
// ((17*x+7*y)%256, (13*x+23*y)%256, (9*x+11*y)%256),
// alpha = x%7 === 0 ? 0 : (5*x+11*y)%256. RGB uses -alpha off;
// lossless uses -define webp:lossless=true -define webp:exact=true.
// Expected RGBA comes from native magick decoding each WebP at depth 8.
for (const fixture of webpFixtures) {
  it(`decodes native ${fixture.name} WebP pixels synchronously`, () => {
    const decoded = decodeWebpImage(Buffer.from(fixture.webp, "base64"));
    expect([decoded.width, decoded.height]).toEqual([64, 48]);
    expect(decoded.data).toEqual(new Uint8Array(Buffer.from(fixture.rgba, "base64")));
  });
  it(`decodes native ${fixture.name} WebP through retained storage`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.webp", Buffer.from(fixture.webp, "base64"));
    const image = sharp("/input.webp", { filesystem: fs });
    try {
      const pixels = await image.ensureAlpha().raw().toBuffer();
      expect(new Uint8Array(pixels)).toEqual(new Uint8Array(Buffer.from(fixture.rgba, "base64")));
    } finally {
      await image.dispose();
    }
  });
}

it("rejects incomplete lossy payloads instead of returning black pixels", async () => {
  const fs = new MemoryFileSystem();
  for (const fixture of webpFixtures.slice(0, 2)) {
    const truncated = Buffer.from(fixture.webp, "base64").subarray(0, -2);
    expect(() => decodeWebpImage(truncated)).toThrow();
    await fs.writeFile("/input.webp", truncated);
    const image = sharp("/input.webp", { filesystem: fs });
    try {
      await expect(image.raw().toBuffer()).rejects.toThrow();
    } finally {
      await image.dispose();
    }
  }
});

it("enforces input pixel limits before lossy decoding", async () => {
  const fs = new MemoryFileSystem();
  const input = Buffer.from(webpFixtures[0]!.webp, "base64");
  await fs.writeFile("/input.webp", input);
  for (const source of [input, "/input.webp"]) {
    const image = sharp(source, { filesystem: fs, limitInputPixels: 100 });
    try {
      await expect(image.raw().toBuffer()).rejects.toThrow("pixel limit");
    } finally {
      await image.dispose();
    }
  }
});

for (const abort of [false, true]) {
  it(`uses bounded borrowed input and backing transfers (abort=${abort})`, async () => {
    const fixture = webpFixtures[1]!;
    const input = Buffer.from(fixture.webp, "base64");
    const borrowed = new Uint8Array(4096);
    const pixels = new Uint8Array(64 * 48 * 4);
    const controller = new AbortController();
    const reason = new Error("cancelled backing write");
    let writes = 0;
    const result = decodeWebpToStorage({ size: input.length, async read(at, length) {
      expect(length).toBeLessThanOrEqual(4096);
      borrowed.fill(0);
      borrowed.set(input.subarray(at, at + length));
      return borrowed.subarray(0, length);
    } }, {
      allocate(length) { expect(length).toBe(pixels.length); return 0; },
      async read(at, length) { return pixels.slice(at, at + length); },
      async write(at, bytes) {
        expect(bytes.length).toBeLessThanOrEqual(4096);
        pixels.set(bytes, at);
        writes++;
        if (abort) controller.abort(reason);
      }
    }, controller.signal);
    if (abort) {
      await expect(result).rejects.toBe(reason);
      expect(writes).toBe(1);
    } else {
      await expect(result).resolves.toMatchObject({ width: 64, height: 48, hasAlpha: true });
      expect(pixels).toEqual(new Uint8Array(Buffer.from(fixture.rgba, "base64")));
    }
  });
}
