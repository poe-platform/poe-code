import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Externally generated tagged PNG; use native ImageMagick to inspect saved output.
const input = readFileSync(new URL("./fixtures/append-icc-tagged.png", import.meta.url));
const profile = spawnSync("magick", ["png:-", "icc:-"], { input }).stdout;

for (const retained of [false, true]) for (const lossless of [false, true]) for (const animated of [false, true]) for (const density of [72, 144]) {
  it(`preserves exact ICC bytes in WebP (retained=${retained}, lossless=${lossless}, animated=${animated}, density=${density})`, async () => {
    expect(profile.length).toBeGreaterThan(128);
    const files = new Map<string, Uint8Array>([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const result = await runConvertCli([
      "/in.png", ...(animated ? ["/in.png"] : []), "-define", `webp:lossless=${lossless}`,
      "-density", String(density), "-write", "/copy.webp", "/out.webp"
    ], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    for (const path of ["/copy.webp", "/out.webp"]) {
      const output = retained ? await filesystem.readFile(path) : files.get(path)!;
      expect(Buffer.from(output).includes(profile)).toBe(true);
      // ImageMagick does not expose container profiles on decoded animation frames.
      if (animated) {
        expect(output[20]! & 32).toBe(32);
        expect(Buffer.from(output.subarray(30, 34)).toString()).toBe("ICCP");
        const size = new DataView(output.buffer, output.byteOffset).getUint32(34, true);
        expect(Buffer.from(output.subarray(38, 38 + size))).toEqual(profile);
        const decoded = spawnSync("magick", ["webp:-", "null:"], { input: output });
        expect(decoded.status, decoded.stderr.toString()).toBe(0);
      } else {
        const recovered = spawnSync("magick", ["webp:-", "icc:-"], { input: output });
        expect(recovered.status, recovered.stderr.toString()).toBe(0);
        expect(recovered.stdout).toEqual(profile);
      }
    }
    expect(await runConvertCli(["/in.png", "-strip", "-define", `webp:lossless=${lossless}`, "/stripped.webp"],
      retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const stripped = retained ? await filesystem.readFile("/stripped.webp") : files.get("/stripped.webp")!;
    const metadata = spawnSync("magick", ["identify", "-format", "%[profiles]", "webp:-"], { input: stripped });
    expect(metadata.status).toBe(0);
    expect(metadata.stdout.toString()).not.toContain("icc");
  });
}
