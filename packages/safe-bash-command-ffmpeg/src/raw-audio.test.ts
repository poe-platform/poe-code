import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg output for PCM16 [-32768, -16385, -257, -1, 0, 1, 257, 16385, 32767].
const golden = {
  s16le: "0080ffbffffeffff0000010001010140ff7f",
  s16be: "8000bffffeffffff00000001010140017fff",
  u8: "003f7e7f808081c0ff",
  s8: "80bffeff000001407f",
  s24le: "00008000ffbf00fffe00ffff00000000010000010100014000ff7f",
  s24be: "800000bfff00feff00ffff000000000001000101004001007fff00",
  s32le: "000000800000ffbf0000fffe0000ffff000000000000010000000101000001400000ff7f",
  s32be: "80000000bfff0000feff0000ffff0000000000000001000001010000400100007fff0000",
  f32le: "000080bf000200bf008000bc000000b800000000000000380080003c0002003f00fe7f3f",
  f32be: "bf800000bf000200bc008000b800000000000000380000003c0080003f0002003f7ffe00",
  f64le: "000000000000f0bf000000004000e0bf00000000001080bf00000000000000bf0000000000000000000000000000003f000000000010803f000000004000e03f00000000c0ffef3f",
  f64be: "bff0000000000000bfe0004000000000bf80100000000000bf0000000000000000000000000000003f000000000000003f801000000000003fe00040000000003fefffc000000000",
  mulaw: "000f677effffe78f80",
  alaw: "2a3a4555d5d5c5baaa"
};

for (const [format, hex] of Object.entries(golden)) {
  for (const sync of [false, true]) {
    it(`writes headerless ${format} (${sync ? "sync" : "async"})`, async () => {
      const input = Buffer.from("524946463600000057415645666d74201000000001000100401f0000803e0000020010006461746112000000" + golden.s16le, "hex");
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-f", format, "/out.bin"];
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
      assert.deepEqual(volume.readFileSync("/out.bin"), Buffer.from(hex, "hex"));
    });
  }
}

it("interleaves stereo channels, honors an explicit encoder, and copies packets without headers", () => {
  const input = Buffer.from("524946462c00000057415645666d74201000000001000200401f0000007d00000400100064617461080000000080ff7fffff0100", "hex");
  for (const [codec, format, expected] of [["pcm_s16be", "s16be", "80007fffffff0001"], ["copy", "s16le", "0080ff7fffff0100"]]) {
    let output: Uint8Array | undefined;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.wav", "-c:a", codec!, "-f", format!, "/out.bin"],
      undefined, () => input, (_path, bytes) => { output = bytes; return true; }), "");
    assert.ok(output);
    assert.deepEqual(Buffer.from(output), Buffer.from(expected!, "hex"));
  }
});

for (const [format, digest] of [
  ["mulaw", "e0be5288dc67592c7281f521cafb4d38cdee27e7d1aced826a99b07b0a557b78"],
  ["alaw", "de19ff5b8d6a1950aa98385b61c7f7740a2ca88926fa86afd5986341f343a82c"]
] as const) {
  it(`matches native FFmpeg ${format} for every PCM16 sample`, () => {
    const input = Buffer.alloc(44 + 65536 * 2);
    Buffer.from("524946460000000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex").copy(input);
    input.writeUInt32LE(input.length - 8, 4);
    input.writeUInt32LE(input.length - 44, 40);
    for (let i = 0; i < 65536; i++) input.writeInt16LE(i - 32768, 44 + i * 2);
    let output: Uint8Array | undefined;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.wav", "-f", format, "/out.bin"],
      undefined, () => input, (_path, bytes) => { output = bytes; return true; }), "");
    assert.ok(output);
    assert.equal(output.length, 65536);
    assert.equal(createHash("sha256").update(output).digest("hex"), digest);
  });
}
