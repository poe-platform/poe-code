import assert from "node:assert/strict";
import { it } from "node:test";
import { mkvAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const output of ["webm", "mkv"]) {
    for (const copy of [false, true]) {
      for (const kind of copy ? [undefined, "subtitles", "captions", "descriptions", "metadata"] : [undefined]) {
        it(`${sync ? "sync" : "async"} ${copy ? "copies WebVTT" : "converts SubRip"} to ${output} with ${kind}`, async () => {
          const input = copy
            ? "WEBVTT\n\nscene-A\n00:00.250 --> 00:01.125 align:end position:80%\nFirst line\n\nscene-B\n00:01.750 --> 00:03.500 line:10%\nSecond line\n"
            : "1\n00:00:00,250 --> 00:00:01,125\nFirst line\n\n2\n00:00:01,750 --> 00:00:03,500\nSecond line\n";
          const source = copy ? "/in.vtt" : "/in.srt";
          const volume = Volume.fromJSON({ [source]: input });
          const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
          const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
          const target = `/out.${output}`;
          const args = ["-y", "-v", "error", ...(kind ? ["-kind", kind] : []), "-i", source, ...(!sync ? ["-map", "0:s:0"] : []), "-c:s", copy ? "copy" : "webvtt", target];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, read, write), "");
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
            assert.equal(result.exitCode, 0, stderr);
          }
          const bytes = volume.readFileSync(target) as Buffer;
          const disposition = mkvAst().probe(bytes).streams[0]!.disposition;
          for (const name of ["captions", "descriptions", "metadata"]) {
            assert.equal(disposition[name], copy && kind === name ? 1 : 0);
          }
          assert.ok(bytes.includes(Buffer.from(`D_WEBVTT/${kind?.toUpperCase() ?? "SUBTITLES"}`)));
          assert.ok(bytes.includes(Buffer.from(copy ? "scene-A\nalign:end position:80%\nFirst line" : "\n\nFirst line")));
          assert.equal(evalSyncFfmpeg(["-i", target, "-c:s", "copy", "/roundtrip.vtt"], undefined, read, write), "");
          assert.equal(volume.readFileSync("/roundtrip.vtt", "utf8"), copy ? input :
            "WEBVTT\n\n00:00.250 --> 00:01.125\nFirst line\n\n00:01.750 --> 00:03.500\nSecond line\n");
        });
      }
    }
  }
}

it("scopes WebVTT kind to the next input and rejects invalid kinds without replacing output", async () => {
  const input = "WEBVTT\n\n00:00.125 --> 00:00.625\nFirst\n";
  const volume = Volume.fromJSON({ "/in.vtt": input, "/out.webm": "original" });
  const scoped = ["-kind", "captions", "-i", "/in.vtt", "-i", "/in.vtt", "-map", "1:s:0", "-c", "copy", "/out.webm"];
  for (const args of [["-kind", "unknown", "-i", "/in.vtt", "/out.webm"], scoped]) {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (args === scoped) {
      assert.equal(result.exitCode, 0, stderr);
      assert.ok((volume.readFileSync("/out.webm") as Buffer).includes(Buffer.from("D_WEBVTT/SUBTITLES")));
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.webm", "utf8"), "original");
    }
  }
});
