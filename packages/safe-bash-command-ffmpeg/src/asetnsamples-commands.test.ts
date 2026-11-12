import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 11 }, (_, i) => 101 + i);

// Native FFmpeg 7.0.2 reference PCM for eleven mono samples at 1 kHz.
for (const graph of [false, true]) {
  for (const [command, options, suffix, expected] of [
    ["0 asetnsamples@group n 2", "n=4:p=1", ",aselect='eq(n,1)'", [103, 104]],
    ["0 asetnsamples@group nb_out_samples 2", "n=4:p=1", ",aselect='eq(n,1)'", [103, 104]],
    ["0.006 asetnsamples@group nb_out_samples 5", "n=4:p=1", "", [...samples, 0, 0, 0]],
    ["0.006 asetnsamples@group n 5", "n=4:p=1", "", [...samples, 0, 0, 0]],
    ["0 asetnsamples@group pad 0", "n=4:p=1", "", samples],
    ["0.006 asetnsamples@group p 0", "n=4:p=1", "", samples],
    ["0.006 asetnsamples@group pad 0", "n=4:p=1", "", samples],
    ["0 asetnsamples@group p 0", "n=4:p=1", "", samples],
    ["0.003 asetnsamples@group n 5", "n=4:p=1", "", [...samples, 0, 0, 0, 0]],
    ["0.003 asetnsamples@group n 2", "n=4:p=1", ",aselect='eq(n,1)'", [103, 104]],
    ["0.006 asetnsamples@group n 2", "n=4:p=1", ",aselect='eq(n,1)'", [105, 106]],
    ["0.007 asetnsamples@group n 5", "n=4:p=1", "", [...samples, 0, 0]],
    ["0 asetnsamples@group p 0;0.006 asetnsamples@group pad 1", "n=4:p=1", "", [...samples, 0]],
    ["0 asetnsamples@group n 2;0.006 asetnsamples@group nb_out_samples 5", "n=4:p=1", "", samples],
    ["0.006 asetnsamples@group n 5", "n=4:p=0", "", samples],
    ["1 asetnsamples@group p 0", "n=4:p=1", "", [...samples, 0]],
    ["1 asetnsamples@group n 5", "n=4:p=1", "", [...samples, 0]],
    ["0 asetnsamples@other p 0", "n=4:p=1", "", [...samples, 0]],
    ["", "n=2:p=1", ",aselect='eq(n,1)'", [103, 104]],
    ["", "n=4:p=0", "", samples]
  ] as const) {
    it(`asetnsamples commands ${command || options}${suffix} (graph=${graph})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=3:p=0,${command ? `asendcmd=c='${command}',` : ""}` +
        `asetnsamples@group=${options}${suffix}`;
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
