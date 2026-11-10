import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: mono PCM16 at 8 kHz uses 512-sample source packets.
for (const graph of [false, true]) {
  for (const padding of [undefined, 0, 4]) {
    it(`preserves source positions with ${padding === undefined ? "no apad" : `apad=pad_len=${padding}`} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(1200 * 2);
      for (let i = 0; i < 1200; i++) input.writeInt16LE(101 + i, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `${padding === undefined ? "" : `apad=pad_len=${padding},`}asetpts=POS,volume=t*8:eval=frame`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
      assert.equal(output.length, (1200 + (padding ?? 0)) * 2);
      assert.equal(output.readInt16LE(512 * 2), 628);
      assert.equal(createHash("sha256").update(output).digest("hex"), padding === 4
        ? "40ffd668890adf36f16e9620368440904d0178e5c7913635c2de80cfb1c29c01"
        : "6101e4998725140d3413456dc8bc79e43631099e10b0eebb7a4867dbb196b60d");
    });
  }
}
