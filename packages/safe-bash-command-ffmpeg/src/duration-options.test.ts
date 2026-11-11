import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const inputOption of [false, true]) {
    for (const option of ["-ss", "-t", "-to"]) {
      for (const [value, boundary] of [
        ["0.253garbage", undefined], ["253garbagems", undefined], ["00:00:00.253garbage", undefined], ["", undefined],
        ["0.000187", 1], ["0.0001879", 1], ["0.000188", 2], ["0.0003125", 2], ["0.000313", 3],
        ["00:00:00.0001879", 1], ["0.1879ms", 1], ["187.9us", 1], ["0.0001879s", 1],
        ["0.253", 2024], ["253ms", 2024], ["253000us", 2024], ["0.253s", 2024], ["00:00:00.253", 2024]
      ] as const) {
        it(`${sync ? "sync" : "async"} ${inputOption ? "input" : "output"} ${option} ${JSON.stringify(value)} validates the complete duration`, async () => {
          const valid = boundary !== undefined;
          // Decoded PCM output cuts use the async path to retain frame timing.
          const supported = valid && (!sync || inputOption);
          const volume = Volume.fromJSON({});
          const samples = Float64Array.from({ length: 16000 }, (_, index) => index / 32768);
          volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
          const args = ["-y", ...(inputOption ? [option, value] : []), "-i", "/in.wav",
            ...(!inputOption ? [option, value] : []), "-c:a", "pcm_s16le", "/out.wav"];
          const errors: Uint8Array[] = [];
          const execute = async () => {
            if (sync) {
              return evalSyncFfmpeg(args, undefined,
                path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Buffer) : undefined,
                (path, bytes) => { volume.writeFileSync(path, bytes); return true; }) === "";
            }
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(), stdout: { async write() {} },
              stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
            } as never);
            return result.exitCode === 0;
          };
          assert.equal(await execute(), supported, Buffer.concat(errors).toString());
          assert.equal(volume.existsSync("/out.wav"), supported);
          if (supported) {
            const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
            assert.deepEqual(Array.from(actual), Array.from(option === "-ss" ? samples.subarray(boundary) : samples.subarray(0, boundary)));
          } else {
            if (!sync) assert.ok(Buffer.concat(errors).toString().includes(option));
            volume.writeFileSync("/out.wav", "keep");
            assert.equal(await execute(), false);
            assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
          }
        });
      }
    }
  }
}
