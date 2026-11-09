import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string[], existing = false) {
  const volume = Volume.fromJSON({
    "/in.mp4": Buffer.from(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 3, includeAudio: false })),
    ...(existing ? { "/out.m3u8": "original playlist", "/out0.ts": "original segment" } : {})
  });
  const before = volume.toJSON();
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", ...options, "/out.m3u8"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async rm(path: string) { volume.unlinkSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, before };
}

for (const [option, valid] of [
  ["-hls_time", "1"],
  ["-hls_init_time", "1"],
  ["-hls_list_size", "1"],
  ["-hls_delete_threshold", "1"],
  ["-hls_segment_type", "mpegts"],
  ["-hls_playlist_type", "vod"],
  ["-hls_flags", "omit_endlist"]
] as const) {
  it(`uses the effective ${option} after replacing an invalid assignment`, async () => {
    const expected = await run([option, valid]);
    const actual = await run([option, "bad", option, valid]);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.volume.toJSON(), expected.volume.toJSON());
    if (option === "-hls_flags") {
      assert.ok(!String(actual.volume.readFileSync("/out.m3u8")).includes("#EXT-X-ENDLIST"));
    }
  });

  it(`rejects an invalid final ${option} without modifying existing output`, async () => {
    const { result, stderr, volume, before } = await run([option, valid, option, "bad"], true);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes(option === "-hls_flags" ? "unrecognized HLS flag 'bad'" : `invalid ${option.slice(1)}`), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

for (const flags of [["bad", "+omit_endlist"], ["bad", "-omit_endlist"], ["omit_endlist", "+bad"]]) {
  it(`retains invalid flag assignments when modified: ${flags.join(";")}`, async () => {
    const { result, stderr, volume, before } = await run(flags.flatMap(value => ["-hls_flags", value]), true);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes("unrecognized HLS flag 'bad'"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

for (const [flags, effective] of [
  [["bad", "+omit_endlist", "discont_start"], "discont_start"],
  [["omit_endlist", "discont_start"], "discont_start"],
  [["omit_endlist", "+discont_start"], "omit_endlist+discont_start"],
  [["omit_endlist+discont_start", "-omit_endlist"], "discont_start"],
  [["bad", "omit_endlist", "+discont_start", "-omit_endlist"], "discont_start"]
] as const) {
  it(`applies flag replacement and modification in order: ${flags.join(";")}`, async () => {
    const expected = await run(["-hls_flags", effective]);
    const actual = await run(flags.flatMap(value => ["-hls_flags", value]));
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.volume.toJSON(), expected.volume.toJSON());
  });
}

it("resets effective HLS options for each output", async () => {
  const { result, stderr, volume } = await run([
    "-hls_time", "bad", "-hls_time", "1", "-hls_flags", "bad", "-hls_flags", "omit_endlist", "/first.m3u8",
    "-c", "copy", "-f", "hls", "-hls_time", "1"
  ]);
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(!String(volume.readFileSync("/first.m3u8")).includes("#EXT-X-ENDLIST"));
  assert.ok(String(volume.readFileSync("/out.m3u8")).includes("#EXT-X-ENDLIST"));
});

it("does not replace an invalid option in an earlier output group", async () => {
  const { result, stderr, volume, before } = await run([
    "-hls_flags", "bad", "/first.m3u8", "-c", "copy", "-f", "hls", "-hls_flags", "omit_endlist"
  ], true);
  assert.equal(result.exitCode, 1, stderr);
  assert.ok(stderr.includes("unrecognized HLS flag 'bad'"), stderr);
  assert.deepEqual(volume.toJSON(), before);
});
