import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 0 ? 10000 : 100) / 32768),
  Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 4 ? -8000 : -200) / 32768)
] });

// Native Linux FFmpeg 7.0.2 statuses and complete PCM16LE output hashes.
for (const [filter, exitCode, hash] of [
  ["stereowiden=crossfeed=none", 0, "2a17e2f8e93838fcbb51ec3e07a838a44897b42bdf436f026e3515d7749fb9a3"],
  ["stereowiden=drymix=none", 0, "f6dd667f73e0e9b614540366e7c6d12faf3cc6cb18f462765f61d49cdcbc3c10"],
  ["stereowiden=delay=1:feedback=none", 0, "d8946cf9ec48282d50565807344a90bcc2a15861e8ee95388fd69cfd6ca280f3"],
  ["stereowiden=1:none:none:none", 0, "5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5"],
  ["stereowiden=crossfeed=none+0.1", 0, "b05eb456d45c6f5528bf2ebf9865ef94e6da6e0130f9dd0ea15c2a9e2ade5536"],
  ["asetnsamples=n=8:p=0,asendcmd=c=0.002 stereowiden crossfeed none,stereowiden=delay=1:enable=1", 0, "310bf2aa4650f11b6ca33ca7d806927f6dda45af0afd9660a39a4fc959176d3e"],
  ["asetnsamples=n=8:p=0,asendcmd=c=0.002 stereowiden feedback none,stereowiden=delay=1:enable=1", 0, "310bf2aa4650f11b6ca33ca7d806927f6dda45af0afd9660a39a4fc959176d3e"],
  ["asetnsamples=n=8:p=0,asendcmd=c=0.002 stereowiden@w drymix none,stereowiden@w=delay=1:enable=1", 0, "b596140eca4aad4aa42b904385069d6f1b0e1d61e5aeda13b55fca2ca31ce1a2"],
  ["stereowiden=delay=none", 222, undefined],
  ["stereowiden=crossfeed=NONE", 234, undefined]
] as const) {
  for (const graph of [false, true]) {
    for (const expression of new Set([filter, filter.replaceAll("none", "0")])) {
      it(`matches native stereowiden zero gains: ${expression} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${expression}[out]`, "-map", "[out]"] : ["-af", expression]),
          "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (hash === undefined) assert.equal(output.toString(), "KEEP");
        else {
          assert.equal(output.length, 192);
          assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        }
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      });
    }
  }
}
