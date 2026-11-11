import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const timebase of ["oops", "1/1000"]) {
  for (const level of ["error", "quiet"]) {
    it(`exports TIMEBASE=${timebase} with ${level} logging`, async () => {
      const input = `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=${timebase}\nSTART=10\nEND=20\ntitle=One\n`;
      const expected = timebase === "oops"
        ? ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000000000\nSTART=0\nEND=0\nSTART=10\nEND=20\ntitle=One\n"
        : input;
      const volume = Volume.fromJSON({ "/in.meta": input });
      const args = ["-v", level, "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", "pipe:1"];
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout, expected);
      assert.equal(stderr, timebase === "oops" && level === "error"
        ? "[ffmetadata] Expected chapter start timestamp, found TIMEBASE=oops.\n[ffmetadata] Expected chapter end timestamp, found TIMEBASE=oops.\n"
        : "");
      // Recoverable diagnostics require the asynchronous execution path.
      if (timebase === "oops") assert.equal(evalSyncFfmpeg([...args.slice(0, -1), "/out.meta"], undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    });
  }
}
