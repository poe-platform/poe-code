import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[]) {
  const volume = Volume.fromJSON({ "/out.mpd": "existing manifest" });
  volume.writeFileSync("/in.mp4", createSyntheticMp4({ width: 16, height: 16, fps: 2, frameCount: 4, includeAudio: false }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, "/out.mpd"],
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
  return { result, stderr, volume, manifest: volume.readFileSync("/out.mpd", "utf8") as string };
}

for (const [flags, expected] of [
  [[], undefined],
  [["-min_playback_rate", "1", "-max_playback_rate", "1"], undefined],
  [["-min_playback_rate", "0.9"], '<PlaybackRate min="0.90" max="1.00"/>'],
  [["-max_playback_rate", "1.1"], '<PlaybackRate min="1.00" max="1.10"/>'],
  [["-min_playback_rate", "0.9", "-max_playback_rate", "1.1"], '<PlaybackRate min="0.90" max="1.10"/>'],
  [["-min_playback_rate", "9/10", "-max_playback_rate", "11/10"], '<PlaybackRate min="0.90" max="1.10"/>'],
  [["-min_playback_rate", "1.1", "-max_playback_rate", "0.9"], undefined]
] as [string[], string | undefined][]) {
  it(`writes DASH PlaybackRate for ${flags.join(" ") || "defaults"}`, async () => {
    const { result, stderr, manifest } = await run(flags);
    assert.equal(result.exitCode, 0, stderr);
    if (expected) assert.ok(manifest.includes(expected), manifest);
    else assert.ok(!manifest.includes("PlaybackRate"), manifest);
  });
}

for (const flag of ["-min_playback_rate", "-max_playback_rate"]) {
  for (const value of ["0.49", "1.51", "NaN", "Infinity", "bad", ""]) {
    it(`rejects ${flag} ${value} without replacing output`, async () => {
      const { result, stderr, manifest, volume } = await run([flag, value]);
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes(`invalid ${flag.slice(1)}`), stderr);
      assert.equal(manifest, "existing manifest");
      assert.deepEqual(volume.readdirSync("/"), ["in.mp4", "out.mpd"]);
    });
  }
}
