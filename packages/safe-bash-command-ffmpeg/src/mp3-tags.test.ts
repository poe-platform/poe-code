import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/copy-mono.mp3", import.meta.url));
for (const version of [undefined, "0", "3", "4", "2", "bogus"]) {
  for (const trailer of ["0", "1"]) {
    it(`MP3 tags: version ${version ?? "default"}, ID3v1 ${trailer}`, async () => {
      const valid = version !== "2" && version !== "bogus";
      for (const sync of [true, false]) {
        const volume = Volume.fromJSON({ "/in.mp3": input });
        const args = ["-v", "error", "-i", "/in.mp3", "-c", "copy",
          "-metadata", "title=Meeting", "-metadata", "artist=Alice", "-metadata", "comment=Draft",
          ...(version === undefined ? [] : ["-id3v2_version", version]), "-write_id3v1", trailer, "/out.mp3"];
        let stderr = "";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, valid ? "" : undefined);
        } else {
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
          assert.equal(result.exitCode === 0, valid, stderr);
        }
        assert.equal(volume.existsSync("/out.mp3"), valid);
        if (!valid) continue;
        const output = volume.readFileSync("/out.mp3") as Buffer;
        assert.equal(output.subarray(0, 3).toString() === "ID3", version !== "0");
        if (version !== "0") assert.equal(output[3], Number(version ?? "4"));
        assert.equal(output.subarray(-128, -125).toString() === "TAG", trailer === "1");
        if (version !== "0" || trailer === "1") {
          assert.equal(parseAudio(output).tags.title, "Meeting");
          assert.equal(parseAudio(output).tags.comment, "Draft");
        }
        if (spawnSync("ffprobe", ["-version"]).status === 0) {
          const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c", "copy",
            "-metadata", "title=Meeting", "-metadata", "artist=Alice", "-metadata", "comment=Draft",
            ...(version === undefined ? [] : ["-id3v2_version", version]), "-write_id3v1", trailer,
            "-f", "mp3", "pipe:1"], { input });
          assert.equal(native.status, 0, native.stderr.toString());
          if (version !== "0") assert.deepEqual(output.subarray(0, 4), native.stdout.subarray(0, 4));
          assert.equal(native.stdout.subarray(-128, -125).toString() === "TAG", trailer === "1");
          // Native skips its ID3 key conversion when v2 is disabled, losing title/artist in v1.
          if (trailer === "1" && version !== "0") assert.deepEqual(output.subarray(-128), native.stdout.subarray(-128));
          const hashes = (bytes: Uint8Array) => {
            const result = spawnSync("ffprobe", ["-v", "error", "-show_packets", "-show_data_hash", "sha256", "-show_format", "-show_streams", "-of", "json", "pipe:0"], { input: bytes });
            assert.equal(result.status, 0, result.stderr.toString());
            return JSON.parse(result.stdout.toString()).packets.map((packet: { data_hash: string }) => packet.data_hash);
          };
          assert.deepEqual(hashes(output), hashes(input));
          const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
          assert.equal(decoded.status, 0, decoded.stderr.toString());
          assert.ok(decoded.stdout.length > 0);
          const original = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input });
          assert.equal(original.status, 0, original.stderr.toString());
          assert.deepEqual(decoded.stdout, original.stdout);
        }
      }
    });
  }
}
