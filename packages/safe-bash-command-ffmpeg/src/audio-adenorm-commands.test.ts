import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph = false, channels = 1) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.raw", Buffer.alloc(528 * channels * 2));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "f32le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.concat(chunks);
  assert.equal(output.length, 528 * channels * 4);
  return output;
}

const filter = "adenorm@a=level=-120:type=dc";

// Native FFmpeg 7.0.2 float32 output for 528 mono PCM16 silence samples at 8 kHz.
for (const graph of [false, true]) {
  for (const [chain, hash] of [
    [`asendcmd=c=0.004 adenorm@a type ac,${filter}`, "78da9f678244ada2a8e038f194c6daf6db3e2e64448fb2c3db96a402881a092a"],
    [`asendcmd=c=0.004 adenorm@a level -100,${filter}`, "43d38aff8562e76a229bc753a95ae77657d3f0126c6bc954a60b3f439fc32fd8"],
    [`asendcmd=c=0.004 adenorm@a type dc,${filter}`, "6f42824148278a31f3efe6e470dbba2e622d6cfc91d4133f7873640291f8da79"],
    [`asendcmd=c=0.004 adenorm@a level -120,${filter}`, "6f42824148278a31f3efe6e470dbba2e622d6cfc91d4133f7873640291f8da79"],
    [filter, "6f42824148278a31f3efe6e470dbba2e622d6cfc91d4133f7873640291f8da79"],
    ["adenorm@a=level=-120:type=ac", "d4f740f28c691bffa32f9b79e808a82b922b2331d3bb85186331c19d15e768a8"],
    ["adenorm@a=level=-100:type=dc", "77e7c38829206b735d43ca2b01f75e2299a2f93511c2547c5e94fd0d69102c35"]
  ] as const) {
    it(`adenorm matches native ${chain} (graph=${graph})`, async () => {
      const output = await run(`asetnsamples=n=8:p=0,${chain}`, graph);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

it("adenorm updates at the next frame boundary and respects shifted timestamps", async () => {
  const expected = await run(`asetnsamples=8:0,asendcmd=c=0.004 adenorm@a type ac,${filter}`);
  assert.deepEqual(await run(`asetnsamples=8:0,asendcmd=c=0.0035 adenorm@a type ac,${filter}`), expected);
  assert.deepEqual(await run(`asetnsamples=8:0,asetpts=PTS+1/TB,asendcmd=c=1.004 adenorm@a type ac,${filter}`), expected);
  assert.deepEqual(await run(`asetnsamples=8:0,asendcmd=c=0.066 adenorm@a type ac,${filter}`),
    await run(`asetnsamples=8:0,${filter}`));
});

it("adenorm routes commands to the first matching filter or named instance", async () => {
  const first = "adenorm@first=-120:ac";
  assert.deepEqual(await run(`asendcmd=c=0 adenorm type dc,${first},${filter}`),
    await run(`adenorm@first=-120:dc,${filter}`));
  assert.deepEqual(await run(`asendcmd=c=0 adenorm@a type ac,${first},${filter}`),
    await run(`${first},adenorm@a=-120:ac`));
  assert.deepEqual(await run(`asendcmd=c=0 adenorm@missing type ac,${filter}`), await run(filter));
});

it("adenorm preserves AC phase and channel alignment through repeated updates", async () => {
  const output = await run(`asetnsamples=3:0,asendcmd=c='0.000375 adenorm@a type 1;0.00075 adenorm@a level -100;0.001125 adenorm@a type 0',${filter}`, false, 2);
  for (let i = 0; i < 528; i++) {
    const amplitude = i < 6 ? 1e-6 : 1e-5;
    const expected = Math.fround(i >= 3 && i < 9 && i % 2 ? -amplitude : amplitude);
    assert.equal(output.readFloatLE(i * 8), expected, `left sample ${i}`);
    assert.equal(output.readFloatLE(i * 8 + 4), expected, `right sample ${i}`);
  }
});

it("adenorm ignores invalid commands and applies subsequent valid updates", async () => {
  const expected = await run(`asetnsamples=8:0,asendcmd=c=0.004 adenorm@a type ac,${filter}`);
  for (const command of ["level -452", "level -89", "level NaN", "level invalid", "type unknown", "unknown 1"]) {
    assert.deepEqual(await run(`asetnsamples=8:0,asendcmd=c='0.002 adenorm@a ${command};0.004 adenorm@a type ac',${filter}`), expected);
  }
});

it("adenorm preserves the waveform position when switching to square or pulse", async () => {
  for (const [type, alias] of [["square", "2"], ["pulse", "3"]]) {
    for (const value of [type, alias]) {
      const output = await run(`asetnsamples=8:0,asendcmd=c=0.004 adenorm@a type ${value},${filter}`);
      for (let i = 0; i < 528; i++) {
        const noise = i < 32 ? 1e-6 : type === "square" ? (Math.floor(i / 256) % 2 ? -1e-6 : 1e-6)
          : i % 256 ? 0 : 1e-6;
        assert.equal(output.readFloatLE(i * 4), Math.fround(noise), `${value} sample ${i}`);
      }
    }
  }
});

it("adenorm retains updates received while timeline processing is disabled", async () => {
  const output = await run(`asetnsamples=3:0,asendcmd=c='0.000375 adenorm@a type ac;0.00075 adenorm@a level -100',${filter}:enable='gte(n,3)'`);
  for (let i = 0; i < 528; i++) {
    const noise = i < 9 ? 0 : (i - 9) % 2 ? -1e-5 : 1e-5;
    assert.equal(output.readFloatLE(i * 4), Math.fround(noise), `sample ${i}`);
  }
});
