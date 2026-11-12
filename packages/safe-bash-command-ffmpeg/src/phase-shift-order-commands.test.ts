import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(name: string, command = "", order = 8, channels = 1) {
  const input = Buffer.alloc(64 * channels * 2);
  for (let i = 0; i < 64; i++) {
    for (let ch = 0; ch < channels; ch++) input.writeInt16LE((i * 1789) % 32000 - 16000, (i * channels + ch) * 2);
  }
  const fs = Volume.fromJSON({ "/in.raw": input });
  const filter = `asetnsamples=n=8:p=0,${command ? `asendcmd=c='${command}',` : ""}${name}@p=shift=${name === "aphaseshift" ? 0.25 : 80}:order=${order}`;
  let output = Buffer.alloc(0), stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw", "-af", filter, "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output = Buffer.concat([output, bytes]); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(output.length, input.length);
  return output;
}

// Native macOS frequency-shift output can differ by one PCM16 unit from
// the scalar implementation at rounding boundaries.
const frequencyReferences = [
  "f7f864fba32c721f4a05bcfdb4e5a3e669d9fde07ddc0ae80ee934f6fdf9e4065b0bb81666146f4eaf6fa212e904ace824e0d2e240e082ef33efa101d400e111080fc11c35170d21bb215e4eb4fc40bb99cfe0c1dcde41e31bf82d00420b901153147017f2131e146c0c880a1b0ee5fa439422ba0bd9e8e9d80afb0b01207617",
  "eafffaffac032e0109e922f7e821e0127b0e71007bed0cee77e286ee08ed8dfcc6259b1d5d0fcf460868c0036dfb1bd7afd544d186d578dfb7e4d9f3e8f6a406c80e111c19163e15d4178218b81150f554181538e9e5d8c298bfdcb016d7a4dce4ff290a71198220811cc01fe00f4011d8f57e02c01a83f7079f9acba6c5fcf0"
];

// Native FFmpeg PCM16 references for the 64-sample input above; the mid-stream
// order-3 hashes also match the Linux FFmpeg 7.0.2 reproduction.
for (const [name, hashes] of [
  ["aphaseshift", [
    "d0b5e621afaeae0bff37ed014927f03f587d6e0ffaf5363ae36f6119214ea466",
    "63872b00769b41dc7754caef5b8ee30557ed40e76b5b30b70f5c116c0d4708af",
    "9b4674e2f777f81c1c305952c18bf09d4a2a4a192b56a3a61a9d3c3251dfffb4",
    "94a9bc10e9072ae9b47236c4d27306f53faa5a94be029211bcd7a2c6212f2dff",
    "5ccf46f96b426cd9341fc7e0f6e43d026141d1d369d02925705e7a88428f046a"
  ]],
  ["afreqshift", [
    "ff10a04394a5063561dbc34f1fc60100f5d07763acc575e6061f8eadf1283dcb",
    "054fdc490a4f0878daab6d6e33df95700363d39be04a6b04ced22a1eabe9c625",
    "651bb0e2b90f9fac8c0d54f67fb9828ca5f968d7ac277b1fb8474223ff87ec93",
    "5b374784a0d52f62bbc44bde32d61c635b0f56f8fd8069374fc04a37f245f34a",
    "940e969efb2ded3167ffc16af189053003c978d60f8123c0b7af754d70f0c14d"
  ]]
] as const) {
  const commands = [
    `0 ${name}@p order 3`, `0.004 ${name}@p order 3`,
    `0.004 ${name}@p order 16`, `0.002 ${name}@p order 3;0.004 ${name}@p order 8`,
    `0.004 ${name}@p level 0.5`
  ];
  for (const [index, command] of commands.entries()) {
    it(`${name} matches native PCM for ${command}`, async () => {
      const output = await run(name, command);
      if (name === "afreqshift" && (index === 0 || index === 3)) {
        const reference = Buffer.from(frequencyReferences[index === 0 ? 0 : 1]!, "hex");
        for (let i = 0; i < 64; i++) {
          assert.ok(Math.abs(output.readInt16LE(i * 2) - reference.readInt16LE(i * 2)) <= 1, `sample ${i}`);
        }
      } else {
        assert.equal(createHash("sha256").update(output).digest("hex"), hashes[index]);
      }
      if (index === 0) assert.deepEqual(output, await run(name, "", 3));
      if (index === 1 || index === 2) assert.deepEqual(output.subarray(0, 64), (await run(name)).subarray(0, 64));
    });
  }
  it(`${name} preserves no-op and rejected order commands`, async () => {
    const original = await run(name);
    for (const order of ["8", "0", "17", "NaN"]) {
      assert.deepEqual(await run(name, `0.004 ${name}@p order ${order}`), original);
    }
  });
  it(`${name} rounds runtime orders and applies them independently to stereo channels`, async () => {
    const mono = await run(name, `0.004 ${name}@p order 4`);
    const stereo = await run(name, `0.004 ${name}@p order 3.5`, 8, 2);
    for (let i = 0; i < 64; i++) {
      assert.equal(stereo.readInt16LE(i * 4), mono.readInt16LE(i * 2));
      assert.equal(stereo.readInt16LE(i * 4 + 2), mono.readInt16LE(i * 2));
    }
  });
}
