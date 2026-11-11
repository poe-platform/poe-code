import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const option of [
  "gain=4",
  "gain=st(0\\,2)+ld(0)",
  "gain=st(9\\,2)+ld(9)",
  "soft-knee=st(0\\,0.01):gain=4+ld(0)",
  "gain=st(0\\,2)+ld(0):volume=ld(0):delay=ld(0)"
]) for (const graph of [false, true]) {
  it(`compand registers match native gain 4: ${option} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], value => value / 32768)
    ] }));
    const filter = `compand=${option}`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    // FFmpeg 7.0.2 output for the PCM16 fixture above with compand gain 4.
    assert.equal((fs.readFileSync("/out.pcm") as Buffer).toString("hex"),
      "28e5160058223eff8e54fb02d0941beeffffff7f6861a88e85a7e61161b89800");
  });
}
