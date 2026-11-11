import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: -f s16le -ar 8000 -ac 2 -i pipe:0 -fflags +bitexact
// followed by the metadata arguments below and -f wav out.wav.
const both = "524946465200000057415645666d74201000000001000200401f0000007d0000040010004c49535422000000494e464f4941525406000000566f69636500494e414d07000000526f6f6d2041000064617461040000000102fcff";
const scenarios = [
  { tags: ["title=Room A", "artist=Voice"], hex: both },
  { tags: ["artist=Voice", "title=Room A"], hex: both },
  { tags: ["title=Room A"], hex: "524946464400000057415645666d74201000000001000200401f0000007d0000040010004c49535414000000494e464f494e414d07000000526f6f6d2041000064617461040000000102fcff" },
  { tags: ["artist=Voice"], hex: "524946464200000057415645666d74201000000001000200401f0000007d0000040010004c49535412000000494e464f4941525406000000566f6963650064617461040000000102fcff" },
  { tags: [], hex: "524946462800000057415645666d74201000000001000200401f0000007d00000400100064617461040000000102fcff" }
];

for (const { tags, hex } of scenarios) for (const mode of ["async file", "async pipe", "sync file"]) {
  it(`matches native WAV INFO bytes for ${tags.join(", ") || "no tags"} (${mode})`, async () => {
    const input = Buffer.from("0102fcff", "hex");
    const expected = Buffer.from(hex, "hex");
    const pipe = mode === "async pipe";
    if (pipe) {
      // Native nonseekable output leaves RIFF and data sizes unknown.
      expected.writeUInt32LE(0xffffffff, 4);
      expected.writeUInt32LE(0xffffffff, expected.length - input.length - 4);
    }
    const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2",
      "-i", "pipe:0", "-fflags", "+bitexact", ...tags.flatMap(tag => ["-metadata", tag]),
      "-f", "wav", pipe ? "pipe:1" : "/out.wav"];
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    if (mode === "sync file") {
      assert.equal(evalSyncFfmpeg(input, args,
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
        stdin: (async function* () {
          for (let offset = 0; offset < input.length; offset++) yield input.subarray(offset, offset + 1);
        })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
    }
    assert.deepEqual(pipe ? Buffer.concat(stdout) : volume.readFileSync("/out.wav"), expected);
  });
}
