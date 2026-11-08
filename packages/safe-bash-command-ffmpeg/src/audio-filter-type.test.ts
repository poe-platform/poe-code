import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [type, center] of [
  ["blackman_nuttall", [201, -225, 240, 7946, 240, -225, 201]],
  ["kaiser", [211, -229, 242, 7946, 242, -229, 211]],
  ["invalid", undefined],
  ["", undefined]
] as const) {
  it(`selects the requested resampling window: ${type || "missing"}`, async () => {
    const pcm = Buffer.alloc(512);
    pcm.writeInt16LE(16384, 256);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "/in.pcm",
        "-ar", "8000", "-filter_type", ...(type ? [type, "-f", "s16le", "/out.pcm"] : [])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (!center) {
      assert.equal(result.exitCode, 8);
      assert.ok(stderr.includes("filter_type must be"), stderr);
      assert.equal(volume.existsSync("/out.pcm"), false);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length / 2, 128);
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => output.readInt16LE((61 + i) * 2)), center);
  });
}
