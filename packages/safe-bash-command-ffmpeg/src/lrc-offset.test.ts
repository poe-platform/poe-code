import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cases = [
  { header: "500", start: "00:00.500", next: "00:04.500", end: "1193:02:51.795" },
  { header: "+500", start: "00:00.500", next: "00:04.500", end: "1193:02:51.795" },
  { header: "-500", start: "00:01.500", next: "00:05.500", end: "1193:02:52.795" },
  { header: "0", start: "00:01.000", next: "00:05.000", end: "1193:02:52.295" }
].map(({ header, start, next, end }) => ({
  name: header,
  input: `[offset:${header}]\n[00:01.00]one\n[00:05.00]end\n`,
  format: "webvtt",
  expected: `WEBVTT\n\n${start} --> ${next}\none\n\n${next} --> ${end}\nend\n`
}));
cases.push({ name: "changed", input: "[offset:250]\n[00:01.00]one\n[offset:500]\n[00:05.00]end\n", format: "srt",
  expected: "1\n00:00:00,750 --> 00:00:04,500\none\n\n2\n00:00:04,500 --> 1193:02:51,795\nend\n\n" });

for (const sync of [false, true]) {
  for (const { name, input, format, expected } of cases) {
    it(`matches native LRC offset ${name}, sync=${sync}`, async () => {
      const volume = Volume.fromJSON({ "/in.lrc": input });
      const args = ["-v", "error", "-f", "lrc", "-i", "/in.lrc", "-bitexact", "-f", format, sync ? "/out" : "pipe:1"];
      let stdout = "";
      let stderr = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out", "utf8") as string;
      } else {
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(stderr, "");
      assert.equal(stdout, expected);
    });
  }
}
