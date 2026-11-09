import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const rate of [30, 60]) for (const explicit of [false, true]) for (const sync of [false, true]) {
  it(`decodes JACOsub ticks and dialogue (rate=${rate}, explicit=${explicit}, sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.jss": `#T ${rate}\n#S 0:00:00.00\n@15 @45 JL First\\nline\n@60 @105 JL Second\n`, "/out.srt": "keep" });
    const args = ["-y", "-v", "error", ...(explicit ? ["-f", "jacosub"] : []), "-i", "/in.jss", "-c:s", "srt", "/out.srt"];
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
    assert.equal(volume.readFileSync("/out.srt", "utf8"), rate === 30
      ? "1\n00:00:00,500 --> 00:00:01,500\n{\\an1}First\nline\n\n2\n00:00:02,000 --> 00:00:03,500\n{\\an1}Second\n\n"
      : "1\n00:00:00,250 --> 00:00:00,750\n{\\an1}First\nline\n\n2\n00:00:01,000 --> 00:00:01,750\n{\\an1}Second\n\n");
  });
}

it("preserves SubRip multiline dialogue and timing", () => {
  const input = "1\n00:00:00,500 --> 00:00:01,500\nFirst\nline\n\n2\n00:00:02,000 --> 00:00:03,500\nSecond\n\n";
  const volume = Volume.fromJSON({ "/in.srt": input, "/out.srt": "keep" });
  assert.equal(evalSyncFfmpeg(["-v", "error", "-y", "-i", "/in.srt", "-c:s", "srt", "/out.srt"], undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  assert.equal(volume.readFileSync("/out.srt", "utf8"), input);
});

it("exports right and center alignment with a signed timing shift", () => {
  const volume = Volume.fromJSON({ "/in.jss": "#TIMERES 60\n#SHIFT -0:00:00.15\n0:00:01.00 0:00:02.00 JR Right\n@180 @240 JC Center\n" });
  assert.equal(evalSyncFfmpeg(["-v", "error", "-y", "-i", "/in.jss", "-c:s", "srt", "/out.srt"], undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  assert.equal(volume.readFileSync("/out.srt", "utf8"),
    "1\n00:00:00,750 --> 00:00:01,750\n{\\an3}Right\n\n2\n00:00:02,750 --> 00:00:03,750\n{\\an2}Center\n\n");
});
