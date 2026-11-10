import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.alloc(288);
for (let i = 0; i < 72; i++) {
  input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
  input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
}

async function run(options: string[], filter = "anull", extraInputs: string[] = []) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", ...options,
      "-i", "/in.raw", ...extraInputs, "-af", filter, "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const option of ["-channel_layout", "-ch_layout"]) {
  for (const [layout, channels] of [["7.1", 8], ["5.1(side)", 6], ["quad", 4], ["5.1", 6], ["2.1", 3], ["3.0", 3], ["stereo", 2], ["mono", 1]] as const) {
    it(`preserves raw PCM bytes with ${option} ${layout}`, async () => {
      for (const count of [[], ["-ac", String(channels)]]) {
        const result = await run([...count, option, layout]);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.output, input);
        // Native FFmpeg 7.0.2 reference for the 288-byte reproduction.
        assert.equal(createHash("sha256").update(result.output).digest("hex"),
          "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13");
      }
    });
  }
}

for (const channels of [4, 6, 8]) {
  it(`retains raw ${channels}-channel input without an explicit layout`, async () => {
    const result = await run(["-ac", String(channels)]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

for (const [layout, channels, speaker, channel] of [
  ["2.1", 3, "LFE", 2], ["2.1", 3, "FC", -1],
  ["3.0", 3, "FC", 2], ["3.0", 3, "LFE", -1],
  ["quad", 4, "BL", 2], ["quad", 4, "BR", 3],
  ["5.1", 6, "FC", 2], ["5.1", 6, "LFE", 3],
  ["5.1(side)", 6, "SL", 4], ["5.1(side)", 6, "SR", 5], ["5.1(side)", 6, "BL", -1],
  ["7.1", 8, "BL", 4], ["7.1", 8, "BR", 5], ["7.1", 8, "SL", 6], ["7.1", 8, "SR", 7]
] as const) {
  it(`routes ${speaker} from raw ${layout} input by speaker assignment`, async () => {
    const result = await run(["-channel_layout", layout], `pan=mono|c0=${speaker}`);
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = Buffer.alloc(input.length / channels);
    if (channel >= 0) {
      for (let i = 0; i < expected.length / 2; i++) {
        expected.writeInt16LE(input.readInt16LE((i * channels + channel) * 2), i * 2);
      }
    }
    assert.deepEqual(result.output, expected);
  });
}

it("resets the explicit speaker layout for the next raw input", async () => {
  const result = await run(["-channel_layout", "3.0"], "pan=mono|c0=FC",
    ["-f", "s16le", "-ar", "8000", "-ac", "3", "-i", "/in.raw", "-map", "1:a"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.alloc(input.length / 3));
});

for (const layout of ["quad", "5.1", "2.1", "3.0", "5.1(side)", "7.1"]) {
  it(`falls back to asynchronous execution for raw ${layout} without writing output`, () => {
    let writes = 0;
    const result = evalSyncFfmpeg(["-y", "-f", "s16le", "-channel_layout", layout,
      "-i", "/in.raw", "-af", "anull", "-f", "s16le", "/out.raw"], undefined,
    () => input, () => { writes++; return true; });
    assert.equal(result, undefined);
    assert.equal(writes, 0);
  });
}
