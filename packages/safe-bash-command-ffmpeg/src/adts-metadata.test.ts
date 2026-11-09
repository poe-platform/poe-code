import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAdtsStream, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const plain = readFileSync(new URL("./fixtures/adts-metadata-plain.aac", import.meta.url));
const packets = parseAdtsStream(plain).frames;

for (const name of ["plain", "id3", "ape"]) for (const sync of [false, true]) {
  it(`preserves ${name} ADTS metadata and AAC payloads in M4A, sync=${sync}`, async () => {
    const input = readFileSync(new URL(`./fixtures/adts-metadata-${name}.aac`, import.meta.url));
    const volume = Volume.fromJSON({ "/in.aac": input });
    const args = ["-v", "error", "-y", "-i", "/in.aac", "-c:a", "copy", "/out.m4a"];
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
    const output = parseMp4(volume.readFileSync("/out.m4a") as Buffer);
    assert.equal(output.metadata.title, name === "plain" ? undefined : "Meeting");
    assert.equal(output.metadata.artist, name === "plain" ? undefined : "Alice");
    assert.equal(packets.length, 16);
    assert.deepEqual(output.tracks[0]!.samples.map(sample => Buffer.from(sample.data)), packets.map(packet => Buffer.from(packet)));
  });
}
