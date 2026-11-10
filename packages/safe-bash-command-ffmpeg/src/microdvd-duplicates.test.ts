import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected cue numbers, times and dialogue match native FFmpeg 7.0.2.
for (const [name, captions, expected] of [
  ["identical packets", "{25}{50}Same\n{25}{50}Same\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n"],
  ["duplicates after timestamp sorting", "{25}{50}Same\n{75}{100}Later\n{25}{50}Same\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:03,000 --> 00:00:04,000\nLater\n\n"],
  ["different text at identical times", "{25}{50}Same\n{25}{50}Other\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:01,000 --> 00:00:02,000\nOther\n\n"],
  ["same text at different times", "{25}{50}Same\n{75}{100}Same\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:03,000 --> 00:00:04,000\nSame\n\n"],
  ["different end times", "{25}{50}Same\n{25}{75}Same\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:01,000 --> 00:00:03,000\nSame\n\n"],
  ["duplicates separated by distinct text", "{25}{50}Same\n{25}{50}Other\n{25}{50}Same\n",
    "1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:01,000 --> 00:00:02,000\nOther\n\n3\n00:00:01,000 --> 00:00:02,000\nSame\n\n"]
] as const) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} MicroDVD to SRT handles ${name}`, async () => {
      const input = "{1}{1}25\n" + captions;
      const volume = Volume.fromJSON({ "/input": input, "/out.srt": "KEEP" });
      const args = ["-v", "error", "-y", "-f", "microdvd", "-i", "/input", "-c:s", "srt", "/out.srt"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync("/out.srt", "utf8").toString().replaceAll("\r\n", "\n"), expected);
      assert.equal(volume.readFileSync("/input", "utf8"), input);
    });
  }
}
