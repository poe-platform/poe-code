import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const type of ["video", "audio"] as const) {
    for (const [filter, count] of [
      ["noise=drop=gte(n\\,2)", 2],
      ["noise=drop='gte(n,2)'", 2],
      ["null,noise=drop=gte(n\\,2),null", 2],
      ["noise=drop=1", 0],
      ["noise=drop=0", 4],
      ["null", 4]
    ] as const) {
      it(`drops ${type} packets with ${filter} (sync=${sync})`, async () => {
        const input = createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 4, includeAudio: true });
        const original = parseMp4(input);
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const args = ["-y", "-i", "/in.mp4", "-c", "copy", type === "video" ? "-bsf:v" : "-bsf:a", filter, "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          const result = await run(volume, args);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        for (const track of original.tracks) {
          const expected = track.type === type ? track.samples.slice(0, count === 4 ? undefined : count) : track.samples;
          const actual = output.tracks.find(candidate => candidate.type === track.type)?.samples ?? [];
          const packets = (samples: typeof actual) => samples.map(({ data, pts, dts, duration }) => ({ data: Array.from(data), pts, dts, duration }));
          assert.deepEqual(packets(actual), packets(expected));
        }
      });
    }
  }
}

for (const flag of ["-bsf:v", "-bsf:a"]) {
  for (const filter of ["noise=drop=", "noise=drop=unknown", "noise=drop=1,", "noise=drop='1", "noise=drop=-1"]) {
    it(`preserves output for invalid ${flag} ${filter}`, async () => {
      const volume = Volume.fromJSON({
        "/in.mp4": Buffer.from(createSyntheticMp4({ width: 16, height: 16, frameCount: 4, includeAudio: true })),
        "/out.mp4": "existing"
      });
      const args = ["-y", "-i", "/in.mp4", "-c", "copy", flag, filter, "/out.mp4"];
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        () => assert.fail("invalid filter must not write")), undefined);
      const result = await run(volume, args);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing");
    });
  }
}

async function run(volume: Volume, args: string[]) {
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
  return { ...result, stderr };
}
