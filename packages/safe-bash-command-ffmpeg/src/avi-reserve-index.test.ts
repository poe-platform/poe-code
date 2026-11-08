import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/stream-names.avi", import.meta.url)));

for (const sync of [false, true]) {
  for (const streams of sync ? [1] : [1, 2]) {
    it(`reserves AVI index space per stream (${streams}, sync=${sync})`, async () => {
      const offsets: number[] = [];
      for (const [requested, payload] of [[0, 4120], [1, 280], [301, 280], [500, 488], [30000, 29992]]) {
        const files = new Map<string, Uint8Array>([["/in.avi", input]]);
        const args = ["-i", "/in.avi", ...(sync ? [] : ["-map", streams === 1 ? "0:a:0" : "0:a"]), "-c", "copy", "-reserve_index_space", String(requested), "/out.avi"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => files.get(path)!,
            (path, bytes) => { files.set(path, bytes); return true; }), "");
        } else {
          const errors: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return files.get(path)!; },
              async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); },
              async stat(path: string) {
                if (!files.has(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
                return { type: "file", size: files.get(path)!.length, mode: 0o644, mtimeMs: 0 };
              }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        }
        const bytes = Buffer.from(files.get("/out.avi")!);
        offsets.push(bytes.indexOf("movi"));
        const reservations: number[] = [];
        for (let pos = bytes.indexOf("JUNK"); pos !== -1; pos = bytes.indexOf("JUNK", pos + 8)) {
          reservations.push(bytes.readUInt32LE(pos + 4));
        }
        assert.deepEqual(reservations, Array(streams).fill(payload));
        assert.deepEqual(parseAvi(new Uint8Array(bytes)).tracks.map(track => track.samples.map(sample => sample.data)),
          parseAvi(input).tracks.slice(0, streams).map(track => track.samples.map(sample => sample.data)));
      }
      assert.equal(offsets[4]! - offsets[0]!, streams * (30000 - 4128));
    });
  }
}
