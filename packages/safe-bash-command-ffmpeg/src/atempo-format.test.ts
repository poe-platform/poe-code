import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: flanger's planar doubles require conversion before atempo.
for (const [filter, length, hash] of [
  ["flanger,atempo=1.2", 1276, "0529d21235d226a5762f98a9abdb8218a85f8b2801648c7ca3591e5cbc76c499"],
  ["flanger,atempo=1.2,anull", 1276, "0529d21235d226a5762f98a9abdb8218a85f8b2801648c7ca3591e5cbc76c499"],
  ["flanger,atempo=1.2,aformat=dbl", 1276, "05e662265445d25a612c706d48f8e1fa2d702ca1afc8ab82c75f17bf2a65c9b9"],
  ["flanger,atempo=1.2,aformat=s16", 1276, "0529d21235d226a5762f98a9abdb8218a85f8b2801648c7ca3591e5cbc76c499"],
  ["flanger,atempo=1.2,volume=1", 1276, "05e662265445d25a612c706d48f8e1fa2d702ca1afc8ab82c75f17bf2a65c9b9"],
  ["flanger,atempo@x=1.2", 1276, "0529d21235d226a5762f98a9abdb8218a85f8b2801648c7ca3591e5cbc76c499"],
  ["flanger,aformat=s16,atempo=1.2", 1276, "0529d21235d226a5762f98a9abdb8218a85f8b2801648c7ca3591e5cbc76c499"],
  ["flanger,aformat=dbl,atempo=1.2", 1276, "05e662265445d25a612c706d48f8e1fa2d702ca1afc8ab82c75f17bf2a65c9b9"],
  ["atempo=1.2", 1284, "0ddc5d3d19d1594c343eb228e85f683f49b6a8d55367c1f686cda00f3c818759"]
] as const) {
  for (const graph of [false, true]) {
    it(`negotiates atempo precision for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(768 * 2);
      for (let i = 0; i < 768; i++) input.writeInt16LE(i * 1371 % 60001 - 30000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(stderr, "");
      assert.equal(output.length, length);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
