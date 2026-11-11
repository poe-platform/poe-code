import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg output for PCM16 [-32768, -16385, -257, -1, 0, 1, 257, 16385, 32767].
const golden = {
  s16le: "0080ffbffffeffff0000010001010140ff7f",
  s16be: "8000bffffeffffff00000001010140017fff",
  u8: "003f7e7f808081c0ff",
  s8: "80bffeff000001407f",
  u16le: "0000ff3fff7eff7f00800180018101c0ffff",
  u16be: "00003fff7eff7fff800080018101c001ffff",
  u24le: "00000000ff3f00ff7e00ff7f0000800001800001810001c000ffff",
  u24be: "0000003fff007eff007fff00800000800100810100c00100ffff00",
  u32le: "000000000000ff3f0000ff7e0000ff7f000000800000018000000181000001c00000ffff",
  u32be: "000000003fff00007eff00007fff0000800000008001000081010000c0010000ffff0000",
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
  for (const channels of [1, 3]) {
    for (const sync of [false, true]) {
      it(`reads headerless ${format}, ${channels} channels (${sync ? "sync" : "async"})`, async () => {
        const input = Buffer.from(hex, "hex");
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        const args = ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", String(channels), "-i", "/in.raw", "-c:a", "pcm_s16le", "/out.wav"];
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
        const bytes = volume.readFileSync("/out.wav") as Buffer;
        const fmt = bytes.indexOf("fmt ") + 8;
        assert.equal(bytes.readUInt16LE(fmt), channels > 2 ? 0xfffe : 1);
        if (channels > 2) assert.equal(bytes.readUInt16LE(fmt + 24), 1);
        assert.equal(bytes.readUInt16LE(fmt + 2), channels);
        assert.equal(bytes.readUInt32LE(fmt + 4), 8000);
        const data = bytes.indexOf("data");
        const expected = format === "u8" || format === "s8" ? [-32768, -16640, -512, -256, 0, 0, 256, 16384, 32512]
          : format === "mulaw" ? [-32124, -16764, -260, -8, 0, 0, 260, 16764, 32124]
          : format === "alaw" ? [-32256, -16128, -264, -8, 8, 8, 264, 16128, 32256]
          : [-32768, -16385, -257, -1, 0, 1, 257, 16385, 32767];
        assert.equal(bytes.readUInt32LE(data + 4), expected.length * 2);
        assert.deepEqual(expected.map((_, i) => bytes.readInt16LE(data + 8 + i * 2)), expected);
      });
    }
  }
}

for (const sync of [false, true]) {
  for (const placement of ["input", "output", "none"]) {
    for (const codec of ["copy", "pcm_s16le"]) {
      it(`limits headerless PCM duration with ${codec}, ${placement} -t (${sync ? "sync" : "async"})`, async () => {
        const input = Buffer.alloc(16000);
        for (let i = 0; i < 8000; i++) input.writeInt16LE(i, i * 2);
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1",
          ...(placement === "input" ? ["-t", "0.25"] : []), "-i", "/in.raw",
          ...(placement === "output" ? ["-t", "0.25"] : []), "-c:a", codec, "-f", "s16le", "/out.raw"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          if (codec !== "copy" && placement === "output") {
            // Decoded output trimming delegates to the asynchronous command.
            assert.equal(result, undefined);
            assert.equal(volume.existsSync("/out.raw"), false);
            assert.deepEqual(volume.readFileSync("/in.raw"), input);
            return;
          }
          assert.equal(result, "");
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
        // FFmpeg 7.0.2 keeps four 512-frame packets for copy; encoding trims exactly.
        const frames = placement === "none" ? 8000 : codec === "copy" ? 2048 : 2000;
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, frames * 2));
      });
    }
  }
}
