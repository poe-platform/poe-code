import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const baselineHash = "02acb6f48dd9a08f5c7c14f8be257b8c0538c4d879b8b76c31bba20d97d39272";
// Native FFmpeg 7.0.2 PCM16 hashes for 96 mono samples at 8 kHz, in eight-sample frames.
const settings = [
  ["dfrequency", "500", "5b356413de33c0e581de8d3000351e14e60df43128a1c56c7c7173ee81d31367", "1fef976bad9fba70a4165902f6a7b01f0acc49c5b98c5457831668ec9a3ccc13"],
  ["dqfactor", "4", "19bb95768560b4abe223a74590cecf3ce6d91000ea3b26cdce1e5a82a58ac1e4", "c88e5eba7bbf7b622930745a160547bc3ba873e78cc05f35efe80b427a1628f0"],
  ["dftype", "lowpass", "814f4aeefbdab03dedff31db5ff4752ec53ccbaec36cb3f3704de2e83ae53819", "5f888f9bea9cfd62a4e53030aac2c7a58211fbd87cf50447037a80d2a2f39de9"]
] as const;

async function run(filter: string, complex = false, channels = 1): Promise<Buffer> {
  const input = Buffer.alloc(96 * channels * 2);
  for (let i = 0; i < 96; i++) {
    for (let c = 0; c < channels; c++) input.writeInt16LE((i * 3779) % 44001 - 22000, (i * channels + c) * 2);
  }
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  assert.equal(output.length, input.length);
  return output;
}

const prefix = "asetnsamples=n=8:p=0,";
const detector = "adynamicequalizer@e=mode=listen";
for (const complex of [false, true]) {
  it(`preserves the native detector control (${complex ? "graph" : "simple"})`, async () => {
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal(createHash("sha256").update(await run(prefix + detector, complex)).digest("hex"), baselineHash);
    }
  });
  for (const [key, value, staticHash, delayedHash] of settings) {
    for (const time of [undefined, 0, 0.004]) {
      it(`matches native ${key}=${value} at ${time ?? "static"} (${complex ? "graph" : "simple"})`, async () => {
        const baseline = await run(prefix + detector, complex);
        const filter = time === undefined ? `${prefix}${detector}:${key}=${value}`
          : `${prefix}asendcmd=c='${time} adynamicequalizer@e ${key} ${value}',${detector}`;
        for (let repeat = 0; repeat < 3; repeat++) {
          const output = await run(filter, complex);
          assert.equal(createHash("sha256").update(output).digest("hex"), time === 0.004 ? delayedHash : staticHash);
          if (time === 0.004) {
            assert.deepEqual(output.subarray(0, 64), baseline.subarray(0, 64));
            assert.notDeepEqual(output.subarray(64), baseline.subarray(64));
          }
        }
      });
    }
  }
}

it("retains detector settings after invalid and unmatched commands", async () => {
  const expected = await run(`${prefix}asendcmd=c='0.004 adynamicequalizer@e dfrequency 500',${detector}`);
  for (const command of ["dfrequency 0", "dqfactor -1", "dftype bad", "dftype 4", "unknown 1"]) {
    assert.deepEqual(await run(`${prefix}asendcmd=c='0.002 adynamicequalizer@missing dqfactor 4;0.004 adynamicequalizer@e dfrequency 500;0.008 adynamicequalizer@e ${command}',${detector}`), expected);
  }
});

it("applies detector updates independently to each channel", async () => {
  const filter = `${prefix}asendcmd=c='0.004 adynamicequalizer@e dfrequency 500;0.008 adynamicequalizer@e dqfactor 4',${detector}`;
  const mono = await run(filter);
  const stereo = await run(filter, false, 2);
  for (let i = 0; i < 96; i++) {
    assert.equal(stereo.readInt16LE(i * 4), mono.readInt16LE(i * 2));
    assert.equal(stereo.readInt16LE(i * 4 + 2), mono.readInt16LE(i * 2));
  }
});

it("routes detector commands only to the first matching instance", async () => {
  const filters = `${detector},adynamicequalizer@other=mode=listen`;
  assert.deepEqual(await run(`${prefix}asendcmd=c='0.004 adynamicequalizer dfrequency 500',${filters}`),
    await run(`${prefix}asendcmd=c='0.004 adynamicequalizer@e dfrequency 500',${filters}`));
  assert.deepEqual(await run(`${prefix}asendcmd=c='0 adynamicequalizer@other dqfactor 4',${filters}`),
    await run(`${prefix}${filters}:dqfactor=4`));
});
