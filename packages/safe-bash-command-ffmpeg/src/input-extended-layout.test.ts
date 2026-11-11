import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(args: string[], files: Record<string, Buffer>) {
  const volume = Volume.fromJSON({ ...files, "/out.raw": "KEEP" });
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...args], cwd: "/", env: {},
    signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  for (const [path, bytes] of Object.entries(files)) assert.deepEqual(volume.readFileSync(path), bytes);
  return { ...result, stderr, output: Buffer.concat(output), volume };
}

// Two distinct frames per channel; native FFmpeg preserves these bytes exactly.
for (const [layout, channels] of [
  ["FR", 1], ["FL", 1], ["2C", 2], ["9C", 9], ["7.1.2", 10], ["hexadecagonal", 16],
  ["mono", 1], ["stereo", 2], ["5.1(side)", 6]
] as const) {
  for (const option of ["-channel_layout", "-ch_layout"]) {
    for (const explicitCount of [false, true]) {
      it(`preserves raw ${option} ${layout}, explicit channel count=${explicitCount}`, async () => {
        const input = Buffer.alloc(channels * 4);
        for (let frame = 0; frame < 2; frame++) for (let channel = 0; channel < channels; channel++) {
          input.writeInt16LE((channel + 1) * 100 + frame, (frame * channels + channel) * 2);
        }
        const args = ["-f", "s16le", "-ar", "8000", ...(explicitCount ? ["-ac", String(channels)] : []),
          option, layout, "-i", "/in.raw", "-f", "s16le", "pipe:1"];
        const result = await run(args, { "/in.raw": input });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.output, input);
      });
    }
  }
}

it("merges isolated FR then FL inputs in native stereo speaker order", async () => {
  const result = await run([
    "-f", "s16le", "-ar", "8000", "-ac", "1", "-channel_layout", "FR", "-i", "/right.raw",
    "-f", "s16le", "-ar", "8000", "-ac", "1", "-channel_layout", "FL", "-i", "/left.raw",
    "-filter_complex", "[0:a][1:a]amerge=inputs=2[o]", "-map", "[o]", "-f", "s16le", "pipe:1"
  ], { "/right.raw": Buffer.from("64006500", "hex"), "/left.raw": Buffer.from("9cff9bff", "hex") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "9cff64009bff6500");
});

for (const layout of ["", "unknown", "0C", "65C", "2.5C", "FL+unknown", "FL+FL"]) {
  it(`rejects invalid raw layout ${JSON.stringify(layout)} before overwriting output`, async () => {
    const result = await run(["-f", "s16le", "-ar", "8000", "-channel_layout", layout,
      "-i", "/in.raw", "-f", "s16le", "/out.raw"], { "/in.raw": Buffer.from("64006500", "hex") });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

for (const layout of ["FR", "FL", "2C", "9C", "7.1.2", "hexadecagonal"]) {
  it(`defers raw ${layout} from synchronous execution without writing`, () => {
    const result = evalSyncFfmpeg(["-f", "s16le", "-channel_layout", layout, "-i", "/in.raw",
      "-f", "s16le", "/out.raw"], undefined, () => Buffer.from("64006500", "hex"),
    () => { assert.fail("synchronous fallback must not write"); });
    assert.equal(result, undefined);
  });
}
