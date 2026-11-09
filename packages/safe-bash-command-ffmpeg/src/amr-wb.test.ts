import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/amr-wb.3gp", import.meta.url));
// Native FFmpeg 7.0.2: -i amr-wb.3gp -c:a pcm_s16le -f s16le amr-wb.s16
const reference = readFileSync(new URL("../../mp4-ast/src/fixtures/amr-wb.s16", import.meta.url));

for (const sync of [false, true]) for (const copy of [false, true]) {
  it(`${sync ? "sync" : "async"} ${copy ? "copies" : "decodes"} AMR-WB packets from 3GP`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.3gp", input);
    const output = copy ? "/out.3gp" : "/out.raw";
    const args = ["-y", "-v", "error", "-i", "/in.3gp", "-c:a", copy ? "copy" : "pcm_s16le",
      "-f", copy ? "3gp" : "s16le", output];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
    const bytes = volume.readFileSync(output) as Buffer;
    if (copy) {
      const packets = (data: Uint8Array) => parseMp4(data, { decodeAudio: false }).tracks[0]!.samples.map(sample => sample.data);
      assert.deepEqual(packets(bytes), packets(input));
    } else {
      assert.equal(bytes.length, 3840);
      assert.equal(bytes.length, reference.length);
      for (let offset = 0; offset < bytes.length; offset += 2) {
        assert.ok(Math.abs(bytes.readInt16LE(offset) - reference.readInt16LE(offset)) <= 2, `PCM sample ${offset / 2}`);
      }
    }
  });
}

it("preserves existing output when an AMR-WB packet cannot decode", async () => {
  const malformed = Buffer.from(input);
  const track = parseMp4(input, { decodeAudio: false }).tracks[0]!;
  malformed[track.samples[0]!.offset!] = 0x54;
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.3gp", malformed);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.3gp", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /AMR-WB/);
  assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
});
