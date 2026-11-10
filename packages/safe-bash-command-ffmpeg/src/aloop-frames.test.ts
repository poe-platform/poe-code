import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references: frames are [PTS, sample count].
for (const complex of [false, true]) {
  for (const frameSize of [3, 4]) {
    for (const select of [false, true]) {
      it(`reframes aloop input of ${frameSize} samples (select=${select}, complex=${complex})`, async () => {
        const input = Buffer.alloc(20);
        for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
        const fs = Volume.fromJSON({ "/in.raw": input });
        const chain = `asetnsamples=n=${frameSize}:p=0,aloop=loop=1:size=4${select ? ",aselect='eq(n,1)'" : ""},ashowinfo`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = fs.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          (select ? [1, 2, 3, 4] : [1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map(n => n * 1000));
        assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
          const fields = line.split(" ");
          return [fields.find(field => field.startsWith("pts:"))!.slice(4),
            fields.find(field => field.startsWith("nb_samples:"))!.slice(11)];
        }), select ? [["4", "4"]] : frameSize === 3
          ? [["0", "4"], ["4", "4"], ["8", "2"], ["10", "3"], ["13", "1"]]
          : [["0", "4"], ["4", "4"], ["8", "4"], ["12", "2"]]);
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
      });
    }
  }
}
