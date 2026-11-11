import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const reversed of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} PJS numbers SRT cues chronologically (${reversed ? "reversed" : "ordered"} input)`, async () => {
        const records = ['10,20,"Alpha"', '30,40,"Beta"'];
        const volume = Volume.fromJSON({ "/input.pjs": (reversed ? records.reverse() : records).join("\n") + "\n" });
        const args = ["-v", "error", ...(forced ? ["-f", "pjs"] : []), "-i", "/input.pjs", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.srt", "utf8") as string;
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
          assert.equal(result.exitCode, 0);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, "1\n00:00:01,000 --> 00:00:02,000\nAlpha\n\n2\n00:00:03,000 --> 00:00:04,000\nBeta\n\n");
      });
    }
    for (const [dialogue, expected] of [
      ["First|Second", "First\r\nSecond"],
      ["|A", "\r\nA"],
      ["A|", "A\r\n"],
      ["A||B", "A\r\n\r\nB"],
      ["First", "First"],
      ["First, second", "First, second"]
    ]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} PJS to SRT matches native dialogue ${dialogue}`, async () => {
        const volume = Volume.fromJSON({ "/input.pjs": `10,20,"${dialogue}"\n`, "/out.srt": "KEEP" });
        const args = ["-v", "error", "-y", ...(forced ? ["-f", "pjs"] : []), "-i", "/input.pjs", "-c:s", "srt", "/out.srt"];
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
        assert.equal(volume.readFileSync("/out.srt", "utf8"),
          `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
      });
    }
  }
}

for (const sync of [false, true]) {
  for (const format of ["pjs", "srt"]) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} ${format} input preserves subtitle timing and lines`, async () => {
        const volume = Volume.fromJSON({ [`/input.${format}`]: format === "pjs"
          ? '12,28,"First|line"\n34,50,"Last & final"\n'
          : "1\n00:00:01,200 --> 00:00:02,800\nFirst line\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n" });
        const target = "/out.vtt";
        const args = ["-v", "error", "-y", ...(forced ? ["-f", format] : []), "-i", `/input.${format}`, target];
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
        assert.equal(volume.readFileSync(target, "utf8"),
          `WEBVTT\n\n00:01.200 --> 00:02.800\n${format === "pjs" ? "First\nline" : "First line"}\n\n00:03.400 --> 00:05.000\nLast & final\n`);
      });
    }
  }
}
