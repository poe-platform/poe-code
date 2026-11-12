import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(2400 * 2);
for (let i = 0; i < 2400; i++) {
  input.writeInt16LE((i % 5 < 2 ? -1 : 1) * 5000 + (i * 301 % 6001 - 3000), i * 2);
}

// Native FFmpeg 7.0.2 PCM16 references for 1200 stereo frames at 8000 Hz.
for (const graph of [false, true]) {
  for (const [expression, hash] of [
    [String.raw`eq(pos\,0)`, "4655845bb3397fec252ffdfb4d4bc6ed308a6a32799653961f2f0abc7e40cef7"],
    [String.raw`gt(pos\,0)`, "6e530687403983e3ee738a243ca6e1a51362fc37038326c79287577db360b9f3"],
    ["isnan(pos)", "24ddaa4710480313757f965c38d60208a334556cb244f830d5006a893edd8da7"],
    ["0", "24ddaa4710480313757f965c38d60208a334556cb244f830d5006a893edd8da7"],
    ["1", "380c07940a212e96c000fa4f5d88cc497fcf5aed72d50fc9663703e07c2cb77c"],
    [String.raw`eq(n\,0)`, "4655845bb3397fec252ffdfb4d4bc6ed308a6a32799653961f2f0abc7e40cef7"],
    // A bare position also returns NaN during initial expression validation.
    ["pos", "6e530687403983e3ee738a243ca6e1a51362fc37038326c79287577db360b9f3"]
  ]) {
    it(`deesser enable=${expression} matches native packet positions (graph=${graph})`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const filter = `deesser=i=0.75:m=0.3:f=0.4:s=e:enable=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", "stereo", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      const output = Buffer.concat(stdout);
      assert.equal(output.length, input.length);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
