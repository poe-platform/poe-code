import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { concatBytes, parseMp4, parseStreamingManifest } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("copies every AAC packet while excluding priming from the advertised DASH duration", async () => {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/dash-priming.mp4", import.meta.url));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/av.mp4", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "av.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "out.mpd"],
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
  const manifest = volume.readFileSync("/out.mpd") as Buffer;
  assert.ok(manifest.toString().includes('<S t="0" d="47104"/><S t="47104" d="48128" r="2"/><S t="191488" d="512"/>'));
  const audio = parseStreamingManifest(manifest, "dash").sequences[1]!;
  const output = parseMp4(concatBytes([
    volume.readFileSync(`/${audio[0]!.initialization}`) as Buffer,
    ...audio.map(part => volume.readFileSync(`/${part.uri}`) as Buffer)
  ])).tracks[0]!;
  const source = parseMp4(input).tracks[1]!;
  assert.equal(output.samples.length, 189);
  assert.deepEqual(output.editList, source.editList);
  assert.deepEqual(output.samples.map(sample => [sample.dts, sample.pts, sample.duration, Buffer.from(sample.data)]),
    source.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]));
});
