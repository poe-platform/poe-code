import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Cue numbers, times, and dialogue from native FFmpeg 7.0.2, with CRLF normalized.
const cases = [
  {
    name: "half-millisecond terminal duration",
    rate: 16,
    input: "{48}{}Last\n",
    copyOutput: "{48}{}Last\n",
    output: "1\n00:00:03,000 --> 1193:02:50,233\nLast\n\n"
  },
  {
    name: "empty end before another cue",
    input: "{25}{}First\n{75}{100}Second\n",
    copyOutput: "{25}{75}First\n{75}{100}Second\n",
    output: "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n\n"
  },
  {
    name: "empty final end",
    input: "{25}{50}First\n{75}{}Last\n",
    copyOutput: "{25}{50}First\n{75}{}Last\n",
    output: "1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n2\n00:00:03,000 --> 1193:02:50,256\nLast\n\n"
  },
  {
    name: "reversed end before another cue",
    input: "{50}{25}Backwards\n{75}{100}Second\n",
    copyOutput: "{50}{75}Backwards\n{75}{100}Second\n",
    output: "1\n00:00:02,000 --> 00:00:03,000\nBackwards\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n\n"
  },
  {
    name: "valid ends",
    input: "{25}{75}First\n{75}{100}Second\n",
    copyOutput: "{25}{75}First\n{75}{100}Second\n",
    output: "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n\n"
  },
  {
    name: "reversed final end",
    input: "{75}{25}Last\n",
    copyOutput: "{75}{}Last\n",
    output: "1\n00:00:03,000 --> 1193:02:48,296\nLast\n\n"
  },
  {
    name: "zero-length cue",
    input: "{25}{25}Zero\n{75}{100}Second\n",
    copyOutput: "{25}{25}Zero\n{75}{100}Second\n",
    output: "1\n00:00:01,000 --> 00:00:01,000\nZero\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n\n"
  },
  {
    name: "out-of-order open cues",
    input: "{75}{}Last\n{25}{}First\n",
    copyOutput: "{25}{75}First\n{75}{}Last\n",
    output: "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:03,000 --> 1193:02:50,256\nLast\n\n"
  }
];

for (const sync of [false, true]) {
  for (const { name, input, output, copyOutput, rate = 25 } of cases) {
    for (const copy of [false, true]) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies" : "exports to SRT"} MicroDVD ${name}`, async () => {
        const source = `{1}{1}${rate}\n` + input;
        const volume = Volume.fromJSON({ "/input": source, "/out.srt": "KEEP" });
        const args = ["-v", "error", "-y", "-f", "microdvd", "-i", "/input",
          ...(copy ? ["-c:s", "copy", "-f", "microdvd"] : ["-c:s", "srt"]), "/out.srt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(volume.readFileSync("/out.srt", "utf8"), copy ? copyOutput : output);
        assert.equal(volume.readFileSync("/input", "utf8"), source);
    });
    }
  }
}
