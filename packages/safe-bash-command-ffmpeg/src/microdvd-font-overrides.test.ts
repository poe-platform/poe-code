import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Complete SRT outputs captured from native FFmpeg 7.0.2, including line endings.
const fixtures = [
  {
    name: "persistent color after a local override",
    input: "{1}{1}25\n{25}{50}{C:$ff0000}Blue|{c:$ff}Red|Blue\n",
    expected: '1\n00:00:01,000 --> 00:00:02,000\n<font color="#0000ff">Blue\r\n<font color="#ff0000">Red</font>\r\nBlue</font>\n\n'
  },
  {
    name: "persistent face after a local override",
    input: "{1}{1}25\n{25}{50}{F:Arial}Arial|{f:Times}Times|Arial\n",
    expected: '1\n00:00:01,000 --> 00:00:02,000\n<font face="Arial">Arial\r\n<font face="Times">Times</font>\r\nArial</font>\n\n'
  },
  {
    name: "persistent size after a local override without leaking into later cues",
    input: "{25}{50}{S:16}A|{s:24}B|C\n{25}{50}First\n{75}{100}Last\n",
    expected: '1\n00:00:01,043 --> 00:00:02,086\n<font size="16">A\r\n<font size="24">B</font>\r\nC</font>\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n'
  },
  {
    name: "persistent face without an override",
    input: "{1}{1}25\n{25}{50}{F:Arial}Hi|next\n",
    expected: '1\n00:00:01,000 --> 00:00:02,000\n<font face="Arial">Hi\r\nnext</font>\n\n'
  }
];

for (const sync of [false, true]) {
  for (const { name, input, expected } of fixtures) {
    it(`${sync ? "sync" : "async"} MicroDVD ${name}`, async () => {
      const volume = Volume.fromJSON({ "/input.sub": input });
      const args = ["-v", "error", "-f", "microdvd", "-i", "/input.sub", "-f", "srt",
        sync ? "/output.srt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/output.srt", "utf8").toString();
      } else {
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
        assert.equal(stderr, "");
      }
      assert.equal(stdout, expected);
      assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
    });
  }
}
