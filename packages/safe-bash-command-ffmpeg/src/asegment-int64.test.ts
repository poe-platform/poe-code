import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const point of ["17", "9007199254740992", "9223372036854775807"]) {
  for (const prefix of [true, false]) {
    it(`accepts sample split ${point} on the ${prefix ? "first" : "second"} branch`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({});
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
          "-i", "pipe:0", "-filter_complex", `[0:a]asegment=samples=${point}[b0][b1];` +
            (prefix ? "[b1]anullsink;[b0]anull[out]" : "[b0]anullsink;[b1]anull[out]"),
          "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(chunks), prefix ? input : Buffer.alloc(0));
    });
  }
}

it("keeps relative sample arithmetic exact before bounding in-memory indices", async () => {
  const { parseAudioSegment } = await import("./audio-asegment.js");
  assert.deepEqual(parseAudioSegment("asegment=samples=-9007199254740993|+9007199254740994"), [
    "atrim=end_sample=0", "atrim=start_sample=0:end_sample=1", "atrim=start_sample=1"
  ]);
  assert.throws(() => parseAudioSegment("asegment=samples=9223372036854775808"), /invalid split point/);
  assert.throws(() => parseAudioSegment("asegment=samples=-9223372036854775809"), /invalid split point/);
  assert.deepEqual(parseAudioSegment("asegment=samples=5trailing"), ["atrim=end_sample=5", "atrim=start_sample=5"]);
});
