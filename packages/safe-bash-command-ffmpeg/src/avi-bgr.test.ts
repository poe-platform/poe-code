import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("stream-copies native padded BGR AVI without changing its codec or pixels", async () => {
  const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/bgr24.avi", import.meta.url)));
    const files = new Map<string, Uint8Array>([["/in.avi", input]]);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.avi", "-c:v", "copy", "/out.avi"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return files.get(path)!; },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); },
        async stat(path: string) {
          if (!files.has(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return { type: "file", size: files.get(path)!.length, mode: 0o644, mtimeMs: 0 };
        }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = parseAvi(input).tracks[0]!;
    const actual = parseAvi(files.get("/out.avi")!).tracks[0]!;
    assert.equal(actual.codecDescriptions[0]!.codecName, "rawvideo");
    assert.equal(actual.codecDescriptions[0]!.pixFmt, "bgr24");
    assert.deepEqual(actual.samples, expected.samples);
    assert.deepEqual(actual.decodedVideoFrames, expected.decodedVideoFrames);
});
