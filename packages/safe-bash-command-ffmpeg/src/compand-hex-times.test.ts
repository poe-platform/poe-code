import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 8000 Hz, rendered as s32le.
for (const [option, remaining, expected] of [
  ["attacks", ":volume=-50", "1defb3029a661fe956d49b5900000080ffffff7f00000080ffffff7f8bcc3c0b"],
  ["decays", ":attacks=0", "b9760e00446085ff3469e30117fea7f4d11fe569165917b815b05e0be41e6100"]
]) for (const time of ["0.0625", "0x1p-4", "+0X1P-4", "0x0.1", "0x1p-4seconds"])
  for (const graph of [false, true]) {
    it(`compand ${option}=${time} matches native samples (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], value => value / 32768)
      ] }));
      const filter = `compand=${option}=${time}${remaining}`;
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    });
  }
