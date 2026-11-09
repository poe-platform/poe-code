import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const singleFile of [false, true]) {
  it(`copies VP9 into native-compatible DASH WebM resources (singleFile=${singleFile})`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/dash-vp9.webm", import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/vp9.webm", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "vp9.webm", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...(singleFile ? ["-single_file", "1"] : []), "out.mpd"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const manifest = volume.readFileSync("/out.mpd", "utf8") as string;
    assert.ok(manifest.includes('mimeType="video/webm"'));
    const paths = singleFile ? ["out-stream0.webm"] : ["init-stream0.webm", "chunk-stream0-00001.webm", "chunk-stream0-00002.webm"];
    const output = Buffer.concat(paths.map(path => volume.readFileSync(`/${path}`) as Buffer));
    assert.deepEqual([...output.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    assert.deepEqual(parseMkv(output).tracks[0]!.samples.map(s => [s.pts, s.data]), parseMkv(input).tracks[0]!.samples.map(s => [s.pts, s.data]));
  });
}
