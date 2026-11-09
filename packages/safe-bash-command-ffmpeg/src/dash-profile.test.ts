import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.mp4", "-c", "copy", "-f", "dash",
      "-seg_duration", "1", ...options, "/out.mpd"],
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
  return { ...result, stderr };
}

const dash = "urn:mpeg:dash:profile:isoff-live:2011";
const dvb = "urn:dvb:dash:profile:dvb-dash:2014";
for (const [profile, expected] of [[undefined, dash], ["dash", dash], ["dvb_dash", dvb], ["dash+dvb_dash", `${dash},${dvb}`], ["dvb_dash+dash", `${dash},${dvb}`]] as const) {
  it(`writes the requested DASH profile ${profile ?? "default"}`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({ width: 32, height: 24, frameCount: 4, includeAudio: false })) });
    const result = await run(volume, profile === undefined ? [] : ["-mpd_profile", profile]);
    assert.equal(result.exitCode, 0, result.stderr);
    const manifest = volume.readFileSync("/out.mpd", "utf8") as string;
    assert.equal(manifest.split('profiles="')[1]?.split('"')[0], expected);
  });
}
for (const profile of ["", "unknown", "dash+unknown"]) {
  it(`rejects invalid DASH profile ${JSON.stringify(profile)} before writing`, async () => {
    const volume = Volume.fromJSON({ "/out.mpd": "keep" });
    const before = volume.toJSON();
    const result = await run(volume, ["-mpd_profile", profile]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("mpd_profile"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
