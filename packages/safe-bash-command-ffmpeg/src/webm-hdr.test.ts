import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/vp9-hdr.webm", import.meta.url));

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} WebM copy preserves PQ and BT.2020 Colour signaling`, async () => {
    const volume = Volume.fromJSON({ "/in.webm": fixture });
    const args = ["-y", "-v", "error", "-i", "/in.webm", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.webm"];
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
    const copied = parseMkv(new Uint8Array(volume.readFileSync("/out.webm") as Buffer));
    const source = parseMkv(new Uint8Array(fixture));
    // Matroska Colour: MatrixCoefficients=9, TransferCharacteristics=16, Primaries=9.
    const colour = Buffer.from([0x55, 0xb0, 0x90, 0x55, 0xba, 0x81, 16,
      0x55, 0xb1, 0x81, 9, 0x55, 0xbb, 0x81, 9, 0x55, 0xb9, 0x81, 1]);
    assert.ok(fixture.includes(colour), "native fixture contains PQ/BT.2020 metadata");
    assert.ok((volume.readFileSync("/out.webm") as Buffer).includes(colour),
      "stream copy retains the native Colour element");
    assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
      source.tracks[0]!.samples.map(sample => sample.data));
  });
}
