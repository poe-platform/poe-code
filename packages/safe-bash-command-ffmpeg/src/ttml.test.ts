import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,240 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n";

for (const sync of [false, true]) {
  for (const flags of [["-f", "ttml"], [], ["-c:s", "ttml"], ["-c:s", "copy"], ["-c:s", "subrip"]]) {
    it(`${sync ? "sync" : "async"} TTML output ${flags.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": srt, "/out.ttml": "existing" });
      const args = ["-v", "error", "-y", "-i", "/in.srt", ...flags, "/out.ttml"];
      const valid = !flags.includes("copy") && !flags.includes("subrip");
      const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
      const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, read, write), valid ? "" : undefined);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { write(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, valid ? 0 : 1, stderr);
      }
      const output = volume.readFileSync("/out.ttml", "utf8");
      if (valid) {
        assert.ok(output.includes('xmlns="http://www.w3.org/ns/ttml"'));
        assert.ok(output.includes('ttp:cellResolution="384 288"'));
        assert.ok(output.includes('<span region="Default">'));
        assert.ok(output.includes('begin="00:00:01.240" end="00:00:02.800"'));
        assert.ok(output.includes('begin="00:00:03.400" end="00:00:05.000"'));
        assert.ok(output.includes("First line<br/>continuation"));
        assert.ok(output.includes("Last &amp; final"));
      } else assert.equal(output, "existing");
      assert.equal(evalSyncFfmpeg(["-i", "/in.srt", "/out.vtt"], undefined, read, write), "");
      assert.equal(volume.readFileSync("/out.vtt", "utf8"),
        "WEBVTT\n\n00:01.240 --> 00:02.800\nFirst line\ncontinuation\n\n00:03.400 --> 00:05.000\nLast & final\n");
    });
  }
}

it("WebVTT to TTML pipe output uses the default layout", async () => {
  const volume = Volume.fromJSON({
    "/in.vtt": "WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\nhello\n\n"
  });
  let output = "";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.vtt", "-bitexact", "-f", "ttml", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.ok(output.includes('xmlns:ttp="http://www.w3.org/ns/ttml#parameter"'), output);
  assert.ok(output.includes('ttp:cellResolution="384 288"'), output);
  assert.ok(output.includes('xmlns:tts="http://www.w3.org/ns/ttml#styling"'), output);
  assert.ok(output.includes('<head><layout><region xml:id="Default"'), output);
  assert.ok(output.includes('tts:origin="3% 0%" tts:extent="97% 97%"'), output);
  assert.ok(output.includes('tts:displayAlign="after" tts:textAlign="center"'), output);
  assert.ok(output.includes('tts:fontSize="16c" tts:fontFamily="Arial" tts:overflow="visible"'), output);
  assert.ok(output.includes('<p begin="00:00:01.000" end="00:00:02.500"><span region="Default">hello</span></p>'), output);
});
