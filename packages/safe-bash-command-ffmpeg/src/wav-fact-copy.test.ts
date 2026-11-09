import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function chunks(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    result.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + size % 2;
  }
  return result;
}

// FFmpeg stream copy of these 8000-sample source WAVs writes the counts below.
for (const [codec, trim, count, size] of [
  ["ac3", false, 9216, 3456], ["mp2", false, 8064, 12096],
  ["pcm_alaw", false, 8000, 8000], ["pcm_alaw", true, 4096, 4096]
] as const) {
  for (const sync of [false, true]) {
    it(`counts copied ${codec} samples${trim ? " after trimming" : ""} (${sync ? "sync" : "async"})`, async () => {
      const input = readFileSync(new URL(`./fixtures/${codec === "pcm_alaw" ? "fact" : "copy"}-${codec}.wav`, import.meta.url));
      const volume = Volume.fromJSON({ "/in.wav": input });
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "copy", ...(trim ? ["-t", "0.08"] : []), "/out.wav"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = chunks(volume.readFileSync("/out.wav") as Buffer);
      assert.deepEqual(output.get("data"), chunks(input).get("data")!.subarray(0, size));
      assert.equal(output.get("fact")!.readUInt32LE(), count);
    });
  }
}
