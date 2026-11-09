import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, createSyntheticMp4, parseMkv, parseMp4, parseStreamingManifest } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const vp9 = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/dash-vp9.webm", import.meta.url)));

async function run(type: string | undefined, input: Uint8Array = vp9) {
  const volume = Volume.fromJSON({ "/out.mpd": "existing manifest" });
  volume.writeFileSync("/in", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...(type === undefined ? ["/out.mpd", "-dash_segment_type"] : ["-dash_segment_type", type, "/out.mpd"])],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

for (const type of ["mp4", "webm", "auto", "0", "1", "2"]) {
  it(`honors -dash_segment_type ${type} for VP9 stream copy`, async () => {
    const { result, stderr, volume } = await run(type);
    assert.equal(result.exitCode, 0, stderr);
    const manifest = volume.readFileSync("/out.mpd") as Buffer;
    const webm = type !== "mp4" && type !== "1";
    assert.ok(manifest.toString().includes(`mimeType="video/${webm ? "webm" : "mp4"}"`));
    const sequence = parseStreamingManifest(manifest, "dash").sequences[0]!;
    const joined = concatBytes([volume.readFileSync(`/${sequence[0]!.initialization}`) as Buffer,
      ...sequence.map(segment => volume.readFileSync(`/${segment.uri}`) as Buffer)]);
    const output = webm ? parseMkv(joined) : parseMp4(joined);
    assert.deepEqual(output.tracks[0]!.samples.map(s => [...s.data]), parseMkv(vp9).tracks[0]!.samples.map(s => [...s.data]));
  });
}

it("accepts explicit MP4 DASH for H.264", async () => {
  const { result, stderr, volume } = await run("mp4", createSyntheticMp4({ includeAudio: false }));
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(volume.readFileSync("/out.mpd", "utf8").toString().includes('mimeType="video/mp4"'));
});

for (const type of [undefined, "", "invalid", "-1", "3"]) {
  it(`rejects invalid DASH segment type ${JSON.stringify(type)} before overwriting output`, async () => {
    const { result, stderr, volume } = await run(type);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("dash_segment_type"), stderr);
    assert.equal(volume.readFileSync("/out.mpd", "utf8"), "existing manifest");
    assert.deepEqual(volume.readdirSync("/"), ["in", "out.mpd"]);
  });
}

it("rejects explicit WebM DASH for H.264 without replacing output", async () => {
  const { result, stderr, volume } = await run("webm", createSyntheticMp4({ includeAudio: false }));
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("WebM"), stderr);
  assert.equal(volume.readFileSync("/out.mpd", "utf8"), "existing manifest");
});
