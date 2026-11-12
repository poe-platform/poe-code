import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const streams = {
  binary: "50350a3220310a3235350a112250350a3220310a3235350a3344",
  ascii: "50320a3220310a3235350a31372033340a50320a3220310a3235350a35312036380a"
};

for (const [encoding, hex] of Object.entries(streams)) {
  for (const format of ["pgm_pipe", "image2pipe"]) {
    for (const source of ["pipe:0", "/input.pgm"]) {
      it(`decodes both ${encoding} PGM frames from ${source} with ${format}`, async () => {
        const input = Buffer.from(hex, "hex");
        const volume = Volume.fromJSON({ "/input.pgm": input });
        const args = ["-v", "error", "-f", format, "-i", source,
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"];
        assert.equal(evalSyncFfmpeg(input, args,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          () => { assert.fail("PGM streams must use the asynchronous demuxer"); }), undefined);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {
            for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
          })(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), "11223344");
      });
    }
  }
}
