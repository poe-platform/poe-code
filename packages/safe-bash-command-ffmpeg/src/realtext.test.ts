import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const realtext = '<window><time begin="0:00.50" end="0:01.50"/><clear/>First<br/>line<time begin="0:02.00" end="0:03.50"/><clear/>Second</window>';
const expected = "1\n00:00:00,500 --> 00:00:01,500\nFirst\nline\n\n2\n00:00:02,000 --> 00:00:03,500\nSecond\n\n";
for (const [input, timing] of [
  ['<window><time begin="1"><clear/>Alpha</window>', "00:01.000 --> 01:01.000"],
  ['<window duration="3"><time begin="1"><clear/>Alpha</window>', "00:01.000 --> 00:04.000"],
  ['<window><time begin="1" end="1"><clear/>Alpha</window>', "00:01.000 --> 01:01.000"],
  ['<window><time begin="3" end="2"><clear/>Alpha</window>', "00:03.000 --> 01:03.000"],
  ['<window duration="3"><time begin="1" end="2"><clear/>Alpha</window>', "00:01.000 --> 00:02.000"]
] as const) {
  it(`converts RealText duration to WebVTT: ${input}`, async () => {
    const volume = Volume.fromJSON({ "/in.rt": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "realtext", "-i", "/in.rt", "-f", "webvtt", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, `WEBVTT\n\n${timing}\nAlpha\n`);
  });
}

for (const begin of ["", ' begin="0"']) {
  for (const sync of [false, true]) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} RealText with ${begin ? "explicit" : "omitted"} begin starts at zero`, async () => {
        const input = `<window><time${begin} end="2"><clear/>Alpha</window>`;
        const volume = Volume.fromJSON({ "/input.rt": input });
        const args = ["-v", "error", ...(forced ? ["-f", "realtext"] : []), "-i", "/input.rt",
          "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
          stdout = volume.readFileSync("/out.vtt", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, "WEBVTT\n\n00:00.000 --> 00:02.000\nAlpha\n");
        assert.equal(volume.readFileSync("/input.rt", "utf8"), input);
      });
    }
  }
}

for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const format of ["realtext", "srt"]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} ${format} preserves timing and lines`, async () => {
        const volume = Volume.fromJSON({ "/input": format === "realtext" ? realtext : expected, "/out.srt": "keep" });
        const args = ["-v", "error", "-y", ...(forced ? ["-f", format] : []), "-i", "/input", "-c:s", "srt", "/out.srt"];
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
        assert.equal(String(volume.readFileSync("/out.srt")).replaceAll("\r\n", "\n"), expected);
      });
    }
  }
}
