import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { latmAst, mp4Ast } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: -i latm-copy.m4a -map 0:a:0 -c:a copy latm-copy.latm.
const input = readFileSync(new URL("./fixtures/latm-copy.m4a", import.meta.url));
for (const explicit of [false, true]) {
  it(`copies M4A AAC to native LOAS/LATM (${explicit ? "explicit format" : "extension"})`, async () => {
    const output = explicit ? "/out.bin" : "/out.latm";
    const volume = Volume.fromJSON({ "/in.m4a": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.m4a", "-map", "0:a:0", "-c:a", "copy",
        ...(explicit ? ["-f", "latm"] : []), output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync(output),
      readFileSync(new URL("./fixtures/latm-copy.latm", import.meta.url)));
  });
}

it("rejects oversized LOAS frames and unsupported AAC configurations", () => {
  const doc = mp4Ast().parse(input, { decodeAudio: false });
  const track = doc.tracks[0]!;
  const sample = track.samples[0]!;
  const withSize = (size: number) => ({ ...doc, tracks: [{ ...track,
    samples: [{ ...sample, data: new Uint8Array(size), size }] }] });
  // First-frame config and length bytes bring an 8153-byte payload to 8191 bytes.
  assert.equal(latmAst().serialize(withSize(8153)).length, 8194);
  assert.throws(() => latmAst().serialize(withSize(8154)), /LOAS frame size limit/);
  assert.throws(() => latmAst().serialize({ ...doc, tracks: [track, track] }), /exactly one/);
  const codec = track.codecDescriptions[0]!;
  assert.throws(() => latmAst().serialize({ ...doc, tracks: [{ ...track,
    codecDescriptions: [{ ...codec, esds: { ...codec.esds!, decoderSpecificInfo: new Uint8Array([0x2b, 0x88]) } }]
  }] }), /AAC-LC configuration/);
});
