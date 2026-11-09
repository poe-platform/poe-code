import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[] = [], failPath?: string) {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 16, includeAudio: false }));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.mp4", serializeMp4({ ...source, tracks: source.tracks.map(track => ({
    ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
  })) }));
  const writes: string[] = [];
  const manifests: string[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, "/out.mpd"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) {
        if (path === failPath) throw new Error("injected write failure");
        volume.writeFileSync(path, bytes);
        writes.push(path);
        if (path === "/out.mpd") manifests.push(new TextDecoder().decode(bytes));
      },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async rm(path: string) { volume.unlinkSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, writes, manifests, volume };
}

it("publishes completed DASH segments before finalizing the static manifest", async () => {
  const { result, stderr, writes, manifests } = await run();
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(writes, ["/init-stream0.m4s", ...[1, 2, 3, 4].flatMap(number => [
    `/chunk-stream0-${String(number).padStart(5, "0")}.m4s`, "/out.mpd"
  ])]);
  assert.equal(manifests.length, 4);
  for (const [index, manifest] of manifests.entries()) {
    assert.ok(manifest.includes(`type="${index === 3 ? "static" : "dynamic"}"`), manifest);
    assert.ok(manifest.includes(index === 0 ? 'd="90000"/>' : `d="90000" r="${index}"/>`), manifest);
    if (index < 3) {
      assert.ok(manifest.includes('minimumUpdatePeriod="PT1S"'), manifest);
      assert.ok(manifest.includes('availabilityStartTime="'), manifest);
      assert.ok(manifest.includes('publishTime="'), manifest);
      assert.ok(!manifest.includes("mediaPresentationDuration="), manifest);
    } else assert.ok(manifest.includes('mediaPresentationDuration="PT4.000000S"'), manifest);
  }
});


it("leaves the last live manifest pointing only to completed chunks on a write failure", async () => {
  const { result, stderr, manifests, volume } = await run([], "/chunk-stream0-00002.m4s");
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("injected write failure"), stderr);
  assert.equal(manifests.length, 1);
  assert.ok(manifests[0]!.includes('type="dynamic"'));
  assert.ok(volume.existsSync("/chunk-stream0-00001.m4s"));
  assert.ok(!volume.existsSync("/chunk-stream0-00002.m4s"));
});

it("removes DASH resources only after publishing the final static manifest", async () => {
  const { result, stderr, manifests, volume } = await run(["-remove_at_exit", "1", "-hls_playlist", "1"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(manifests.length, 4);
  assert.ok(manifests.at(-1)!.includes('type="static"'));
  assert.deepEqual(volume.readdirSync("/"), ["in.mp4"]);
});
