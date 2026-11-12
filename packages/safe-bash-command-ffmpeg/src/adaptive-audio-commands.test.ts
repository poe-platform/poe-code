import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string, commands = "", prefix = "", channels = 1) {
  const input = Buffer.alloc(2400 * channels);
  for (let i = 0; i < 1200; i++) for (let c = 0; c < channels; c++) {
    input.writeInt16LE((i * 7919 + c * 3571) % 22001 - 11000, (i * channels + c) * 2);
  }
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      "-filter_complex", `[0:a]${prefix}asplit[a][b];[a]${commands ? `asendcmd=c='${commands}'` : "anull"}[x];`
        + `[b]adelay=3S:all=1[y];[x][y]${filter}[out]`, "-map", "[out]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = Buffer.concat(output);
  assert.equal(pcm.length, 2400 * channels);
  return createHash("sha256").update(pcm).digest("hex");
}

// Native FFmpeg 7.0.2, 1200 mono PCM16 samples at 8 kHz, desired signal delayed by three samples.
const desired = "4bdf97829da0d40d05ca32eb265a7847c7f8c7abc6ae305210017c0fcaa03583";
for (const [name, baseline, cases] of [
  ["anlms", "dd3951557c3cb7309a5e7cc79183661ceb68dc7b5da64952979c630173370af5", [
    ["mu", "0", desired, "901fa7f311a106821c5246ad6dc2b3d7c3695f70394a6ce63b822310d07a945f"],
    ["eps", "0", "fee790f50418720dc2c69b5f276d6aacaf922f88d645e96679ad85d5c05bf3f4", "475485c609708372987cb867a3bec364ea706f8b9fd4b0efb41b08b91096410b"],
    ["leakage", "1", "19fbc43e838851f84db06c4f5e91410b9fc2ece81498101ecfc35c9f6b957948", "2f956f0edb2f708c906d3ee4ba6253bb8a620323f4ed61bf88c521c3ac8317f9"],
    ["out_mode", "d", desired, "7072bc105c4607b51352f4eedb345bf4d7fcf8738c9bc8a2192e3edfd37ef57e"]
  ]],
  ["anlmf", "91f79a4404a9f6b9897426d3acabd7713961ee85c50ed0f3162c427aa8b094a6", [
    ["mu", "0", desired, "c268d7e2d9268580e5b97e7bfce2c6402a9b7a19d9a0b99d33cf376c33a36276"],
    ["eps", "0", "9a4beb5bb3887621878e176df8ed735ecb7476ea0806307785d1aa79ac7f9972", "89aa5a79fea85c5387ab289e5f245e761bea985cdf99281333240d567c385f5a"],
    ["leakage", "1", "70bdee3cdbf77880ac16fdf406f052fc767c11b53e6a72680a69fce8ec04c316", "e3feba8629b6f77be6b84d316c10f9b755f49f4e6c3b164dec3bcbf55958ffe2"],
    ["out_mode", "d", desired, "a0c9ea12e065ff13bda3a8472ea1926e5b987ab49b62a374eaf8dc35de1439b7"]
  ]]
] as const) {
  it(`${name} retains native baseline and wrong-target behavior`, async () => {
    assert.equal(await render(`${name}=order=4`), baseline);
    assert.equal(await render(`${name}=order=4`, `0 ${name}@other out_mode d`), baseline);
  });
  for (const [option, value, initial, scheduled] of cases) {
    it(`${name} retains native static ${option}`, async () => {
      assert.equal(await render(`${name}=order=4:${option}=${value}`), initial);
    });
    for (const [time, expected] of [["0", initial], ["0.064", scheduled]] as const) {
      it(`${name} applies ${option} at ${time} without restarting adaptation`, async () => {
        assert.equal(await render(`${name}=order=4`, `${time} ${name} ${option} ${value}`), expected);
      });
    }
  }
}

for (const [name, hashes] of [
  ["anlms", ["e71230460fdbb719b27de2da3852a10e01132de0c135cd4c804e9f3731fbd4a5",
    "fbdedd55b946a6731a8f401df39a66f157fbd3d32f35cfa8dfc7e3694b385a97",
    "901fa7f311a106821c5246ad6dc2b3d7c3695f70394a6ce63b822310d07a945f",
    "a73b9a698cfebf5a9bbe9f10ae3f433f8590eff3fcbc53a610ae78505b562ca4",
    "60724f2dabe3c546c51e62835f9852a54ac51634dbe1a25d96b7457f27ef89b6"]],
  // Native -cpuflags 0 for the first anlmf case; SIMD differs by one PCM16 unit in one sample.
  ["anlmf", ["a08f4c0e08f4ca1e2e419b7f84f7b9a2e5c7507baca6723e60027b53b30093f4",
    "01e5270028f7c7584dcc13230f8cdc31c65974689caa914a5f318190075f6798",
    "c268d7e2d9268580e5b97e7bfce2c6402a9b7a19d9a0b99d33cf376c33a36276",
    "2bb0b144ddb8229910d5c5a7d10c8f00d0e44266d5e60282707a95c8e5086efa",
    "b3f2464d49fda17b41fb708d8357aead9ba7e5b356c87ad01e23affb58a2fbdc"]]
] as const) {
  const target = `${name}@adaptive`;
  const filter = `${target}=order=4`;
  it(`${name} dispatches named commands at the next sender frame`, async () => {
    assert.equal(await render(filter, `0.065 ${target} mu 0`), hashes[0]);
    assert.equal(await render(filter, `0.064 ${target} mu 0`, "asetnsamples=200:0,"), hashes[1]);
    assert.equal(await render(filter, `1.064 ${target} mu 0`, "asetpts=PTS+8000,"), hashes[2]);
  });
  it(`${name} preserves adaptation history across repeated commands`, async () => {
    assert.equal(await render(filter, `0.064 ${target} mu 0;0.128 ${target} mu 0.75`), hashes[3]);
  });
  it(`${name} retains valid settings after rejected commands`, async () => {
    assert.equal(await render(filter, `0.064 ${target} mu 0;0.128 ${target} mu invalid;`
      + `0.128 ${target} eps 2;0.128 ${target} order 8`), hashes[2]);
  });
  it(`${name} applies commands independently to stereo channel histories`, async () => {
    assert.equal(await render(filter, `0.064 ${target} mu 0`, "", 2), hashes[4]);
  });
  it(`${name} ignores commands after EOF and unmatched named instances`, async () => {
    const baseline = await render(filter);
    assert.equal(await render(filter, `1 ${target} mu 0`), baseline);
    assert.equal(await render(filter, `0 ${name}@other mu 0`), baseline);
    assert.equal(await render(filter, `0.064 ${name} mu 0`), hashes[2]);
  });
}
