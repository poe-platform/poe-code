import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const invalid = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80]);
const srt = (dialogue: Buffer) => Buffer.concat([
  Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), dialogue, Buffer.from("\n\n")
]);

for (const sync of [false, true]) {
  for (const mode of ["ignore", "2", "do_nothing", "-1", "auto", "0", undefined]) {
    for (const dialogue of [invalid, Buffer.from("Café € �"), Buffer.concat([Buffer.from("<b>"), invalid, Buffer.from("</b>")])]) {
      it(`${sync ? "sync" : "async"} sub_charenc_mode ${mode ?? "default"} with ${dialogue.toString("hex")}`, async () => {
        const input = srt(dialogue);
        const volume = Volume.fromJSON({ "/in.srt": input, "/out.vtt": "KEEP" });
        const args = ["-v", "error", "-y", ...(mode ? ["-sub_charenc_mode", mode] : []), "-i", "/in.srt", "/out.vtt"];
        const rejected = mode !== "ignore" && mode !== "2" && dialogue.includes(0x80);
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), rejected ? undefined : "");
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
          assert.equal(result.exitCode, rejected ? 69 : 0, stderr);
          if (rejected) assert.match(stderr, /Invalid UTF-8 in decoded subtitles text/);
          else assert.equal(stderr, "");
        }
        // Native FFmpeg 7.0.2: ignore preserves e9/80; do_nothing emits only the header.
        const expected = rejected ? Buffer.from(sync ? "KEEP" : "WEBVTT\n") : Buffer.concat([
          Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\n"), dialogue, Buffer.from("\n")
        ]);
        assert.deepEqual(volume.readFileSync("/out.vtt"), expected);
        assert.deepEqual(volume.readFileSync("/in.srt"), input);
      });
    }
  }
}

for (const [name, options, expectedCode, expected] of [
  ["resets after its input", ["-sub_charenc_mode", "ignore", "-i", "/in.srt", "-i", "/second.srt", "-map", "1:s"], 69, Buffer.from("WEBVTT\n")],
  ["resets a numeric mode after its input", ["-sub_charenc_mode", "2", "-i", "/in.srt", "-i", "/second.srt", "-map", "1:s"], 69, Buffer.from("WEBVTT\n")],
  ["does not replace output for an unknown mode", ["-sub_charenc_mode", "unknown", "-i", "/in.srt"], 1, Buffer.from("KEEP")],
  ["does not replace output for a missing mode", ["-sub_charenc_mode"], 1, Buffer.from("KEEP")],
  ["does not replace output for a misplaced mode", ["-i", "/in.srt", "-sub_charenc_mode", "ignore"], 1, Buffer.from("KEEP")]
] as const) {
  it(`sub_charenc_mode ${name}`, async () => {
    const volume = Volume.fromJSON({ "/in.srt": srt(invalid), "/second.srt": srt(invalid), "/out.vtt": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...options, "/out.vtt"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expectedCode, stderr);
    assert.deepEqual(volume.readFileSync("/out.vtt"), expected);
  });
}

for (const [numeric, named] of [["-1", "do_nothing"], ["0", "auto"], ["1", "pre_decoder"], ["2", "ignore"]] as const) {
  for (const mode of [numeric, named]) {
    it(`sub_charenc_mode ${mode} preserves the expected cues and stdout bytes`, async () => {
      const preDecoder = numeric === "1";
      const ignore = numeric === "2";
      const input = preDecoder ? Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nCafé €\n") : Buffer.concat([
        Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nfine\n\n2\n00:00:03,000 --> 00:00:04,000\ncaf"),
        Buffer.from([0xe9]), Buffer.from("\n")
      ]);
      // Native FFmpeg 7.0.2 keeps both mixed-input cues only in ignore mode.
      const expected = preDecoder ? Buffer.from("WEBVTT\n\n00:01.000 --> 00:03.000\nCafé €\n") : Buffer.concat([
        Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\nfine\n"),
        ...(ignore ? [Buffer.from("\n00:03.000 --> 00:04.000\ncaf"), Buffer.from([0xe9]), Buffer.from("\n")] : [])
      ]);
      const volume = Volume.fromJSON({ "/in.srt": input, "/out.vtt": "KEEP" });
      const options = ["-v", "error", "-y", ...(preDecoder ? ["-sub_charenc", "UTF-8"] : []), "-sub_charenc_mode", mode, "-i", "/in.srt"];
      const syncResult = evalSyncFfmpeg([...options, "/out.vtt"], undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(syncResult, preDecoder || ignore ? "" : undefined);
      assert.deepEqual(volume.readFileSync("/out.vtt"), preDecoder || ignore ? expected : Buffer.from("KEEP"));
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...options, "-f", "webvtt", "pipe:1"], cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), expected);
      if (preDecoder || ignore) assert.equal(stderr, "");
      else assert.match(stderr, /Invalid UTF-8 in decoded subtitles text/);
      assert.deepEqual(volume.readFileSync("/in.srt"), input);
    });
  }
}
