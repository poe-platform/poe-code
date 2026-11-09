import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 25, frameCount: 20, includeAudio: true }), { decodeAudio: false });
const input = serializeMp4({ ...doc, tracks: doc.tracks.filter(track => track.type === "audio") });
async function run(volume: Volume, values: string[], sync: boolean, limits = {}) {
  const args = ["-y", "-i", "/in.mp4", ...(!sync ? ["-map", "0:a"] : []), "-c", "copy", ...values, "/out.ts"];
  if (sync) return evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }) === "";
  const result = await createFfmpegCommand({ limits }).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
  } as never);
  return result.exitCode === 0;
}

for (const sync of [false, true]) {
  for (const rate of ["500000", "1M", "0", "1"]) {
    it(`honors -muxrate ${rate} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      assert.equal(await run(volume, ["-muxrate", rate], sync), true);
      const bytes = volume.readFileSync("/out.ts") as Buffer;
      let nulls = 0;
      for (let i = 0; i < bytes.length; i += 188) if ((bytes.readUInt16BE(i + 1) & 8191) === 8191) nulls++;
      assert.equal(nulls > 0, rate !== "0" && rate !== "1");
    });
  }
  for (const rate of ["-1", "bad", "", "Infinity", "2147483648", "1.5"]) {
    it(`rejects -muxrate ${JSON.stringify(rate)} without overwriting (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.ts": "KEEP" });
      assert.equal(await run(volume, ["-muxrate", rate], sync), false);
      assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
    });
  }
}

it("bounds muxrate padding without overwriting the destination", async () => {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.ts": "KEEP" });
  assert.equal(await run(volume, ["-muxrate", "2147483647"], false, { maxOutputBytes: 100000 }), false);
  assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
});
