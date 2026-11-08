import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const copy of [false, true]) {
  it(`${sync ? "sync" : "async"} FLAC ${copy ? "copy" : "encoding"} honors write_header`, async () => {
    const input = readFileSync(new URL("./fixtures/trim-16.flac", import.meta.url));
    const volume = Volume.fromJSON({ "/in.flac": input });
    for (const header of [undefined, "1", "0", "invalid"]) {
      const output = `/out-${header}.flac`;
      const args = ["-y", "-v", "error", "-i", "/in.flac", ...(copy ? ["-c", "copy"] : []),
        "-metadata", "title=header test", "-metadata_header_padding", "128",
        ...(header === undefined ? [] : ["-write_header", header]), output];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), header === "invalid" ? undefined : "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (header === "invalid") assert.notEqual(result.exitCode, 0);
        else assert.equal(result.exitCode, 0, stderr);
      }
      if (header === "invalid") assert.equal(volume.existsSync(output), false);
    }
    const normal = volume.readFileSync("/out-undefined.flac") as Buffer;
    assert.deepEqual(volume.readFileSync("/out-1.flac"), normal);
    const frames = parseAudio(normal).nodes.filter(node => node.type === "FRAMES").map(node => node.data);
    const raw = volume.readFileSync("/out-0.flac") as Buffer;
    assert.deepEqual(raw, Buffer.concat(frames));
    assert.equal(raw[0], 0xff);
    assert.equal(raw[1]! & 0xfe, 0xf8);
  });
}
