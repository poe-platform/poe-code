import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 advances the post-replay clock by emitted samples despite input PTS gaps.
for (const complex of [false, true]) {
  for (const offset of [0, 16]) {
    for (const select of [false, true]) {
      it(`advances aloop tail timestamps by emitted samples (offset=${offset}, select=${select}, complex=${complex})`, async () => {
        const input = Buffer.alloc(29 * 2);
        for (let i = 0; i < 29; i++) input.writeInt16LE(i + 1, i * 2);
        const fs = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=8:p=0,asetpts=2*PTS+${offset},aloop=1:4:0${select ? `,aselect='gte(t,${(offset + 24) / 8000})'` : ""},ashowinfo`;
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); } },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          select ? [25, 26, 27, 28, 29] : [1, 2, 3, 4, 1, 2, 3, 4, ...Array.from({ length: 25 }, (_, i) => i + 5)]);
        assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
        }), (select ? [[28, 5]] : [[0, 4], [4, 4], [8, 4], [12, 8], [20, 8], [28, 5]])
          .map(([pts, count]) => [pts! + offset, count]));
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
      });
    }
  }
}
