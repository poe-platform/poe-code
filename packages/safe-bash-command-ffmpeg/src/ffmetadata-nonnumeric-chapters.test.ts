import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [start, end, expected, diagnostics] of [
  ["10", "bad", "START=10\nEND=10\n", "[ffmetadata] Expected chapter end timestamp, found END=bad.\n"],
  ["bad", "20", "START=0\nEND=0\nEND=20\n", "[ffmetadata] Expected chapter start timestamp, found START=bad.\n[ffmetadata] Expected chapter end timestamp, found START=bad.\n"],
  ["10", "20", "START=10\nEND=20\n", ""]
] as const) {
  for (const level of ["error", "quiet"]) {
    it(`round trips START=${start} END=${end} at ${level} log level`, async () => {
      const volume = Volume.fromJSON({
        "/in.meta": `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/10\nSTART=${start}\nEND=${end}\ntitle=One\n`
      });
      const args = ["-v", level, "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", "pipe:1"];
      // A synchronous result cannot carry stderr; malformed inputs must fall back.
      assert.equal(evalSyncFfmpeg(["-y", ...args.slice(0, -1), "/out.meta"], undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), diagnostics ? undefined : "");
      if (diagnostics) assert.equal(volume.existsSync("/out.meta"), false);
      else assert.equal(volume.readFileSync("/out.meta", "utf8"),
        `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/10\n${expected}title=One\n`);
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout, `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/10\n${expected}title=One\n`);
      assert.equal(stderr, level === "quiet" ? "" : diagnostics);
    });
  }
}
