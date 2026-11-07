import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,250 --> 00:00:03,500\nHello\n\n2\n00:00:05,000 --> 00:00:06,750\nthere\n";

for (const sync of [false, true]) {
  for (const format of ["mp4", "mov"]) {
    for (const explicit of [false, true]) {
      for (const forced of [false, true]) {
        it(`${sync ? "sync" : "async"} ${format} subtitle selection, explicit=${explicit}, forced=${forced}`, async () => {
          const target = forced ? "/out.data" : `/out.${format}`;
          const volume = Volume.fromJSON({ "/in.srt": srt, [target]: "original" });
          const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
          const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
          const args = ["-y", "-v", "error", "-i", "/in.srt",
            ...(explicit ? ["-c:s", "mov_text"] : []), ...(forced ? ["-f", format] : []), target];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, read, write), explicit ? "" : undefined);
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
            assert.equal(result.exitCode, explicit ? 0 : 234, stderr);
            if (!explicit) assert.match(stderr, /Output file does not contain any stream/);
          }
          if (explicit) {
            assert.equal(evalSyncFfmpeg(["-i", target, "/roundtrip.srt"], undefined, read, write), "");
            assert.equal(String(volume.readFileSync("/roundtrip.srt", "utf8")).trimEnd(), srt.trimEnd());
          } else {
            assert.equal(volume.readFileSync(target, "utf8"), "original");
          }
        });
      }
    }
  }
}

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} automatic MP4 selection retains video and audio without subtitles`, async () => {
    const volume = Volume.fromJSON({ "/in.srt": srt });
    volume.writeFileSync("/in.mp4", createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 1, includeAudio: true }));
    const args = ["-i", "/in.mp4", "-i", "/in.srt", "/out.mp4"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
      } as never);
      assert.equal(result.exitCode, 0);
    }
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
    assert.deepEqual(output.tracks.map(track => track.type).sort(), ["audio", "video"]);
  });
}
