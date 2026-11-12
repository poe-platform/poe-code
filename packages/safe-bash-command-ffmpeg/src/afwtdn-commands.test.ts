import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(4800);
for (let i = 0; i < 2400; i++) input.writeInt16LE(i * 13129 % 30001 - 15000, i * 2);
const filter = "afwtdn=samples=512:levels=2:wavet=sym2:sigma=0.1";

// Native FFmpeg 7.0.2, 2400 mono PCM16 samples at 8 kHz, including EOF padding.
const baseline = "942dabff6cb17c861517dc4c09f30eb9892745f8de8036e2140bcaa75d359405";
const bypass = "e965be5982d08327f8fede79bd86f4df1f63610cc74eacd4b296506c1d97f404";
const midstreamBypass = "5b40e74e52ccce2f8881b24b6b210bed102245e64b61324074fb03b8e2e1fc6b";
for (const graph of [false, true]) {
  for (const [option, value, atZero, midstream] of [
    ["sigma", "0", bypass, midstreamBypass],
    ["softness", "0", "8c2a56e90906208d7260d9d8eb0f04f2368cda8baab098bd537f42ef1c497843",
      "dc0455acf66b4a34fade627345d3f976f77ce89767e2f83e3233179b950d806b"],
    ["profile", "1", "7d1756370bb494ec6a79b3865c12f642b0affc44633367ebd4caf5e7ec2558d6",
      "d09f86b902bd75ed542cc27610875fae9f08ff433863e11a736ee3dcbcddf13c"],
    ["adaptive", "1", bypass, baseline],
    ["percent", "0", bypass, midstreamBypass]
  ] as const) {
    it(`applies scheduled afwtdn ${option} at time zero (graph=${graph})`, async () => {
      const actual = await run(`asendcmd=c='0 afwtdn ${option} ${value}',${filter}`, graph);
      assert.equal(createHash("sha256").update(actual).digest("hex"), atZero);
      assert.deepEqual(actual, await run(`${filter}:${option}=${value}`, graph));
    });
    it(`preserves wavelet state for midstream afwtdn ${option} (graph=${graph})`, async () => {
      const actual = await run(`asendcmd=c='0.064 afwtdn ${option} ${value}',${filter}`, graph);
      assert.equal(createHash("sha256").update(actual).digest("hex"), midstream);
    });
    it(`ignores unmatched afwtdn ${option} targets (graph=${graph})`, async () => {
      const actual = await run(`asendcmd=c='0 afwtdn@other ${option} ${value}',${filter}`, graph);
      assert.equal(createHash("sha256").update(actual).digest("hex"), baseline);
    });
  }
}

for (const graph of [false, true]) for (const [commands, channels, hash] of [
  ["0.064 afwtdn@clean sigma 0;0.192 afwtdn@clean sigma 0.1", 2,
    "83c959ad3129115c5cb80c81b109c34c780dfe52cc0486f27c6369afa93c46ef"],
  ["0.064 afwtdn@clean softness 0;0.192 afwtdn@clean softness 1", 2,
    "7ab605bd58f42b0b6bbe178d4cbbaba3c7b0d0f757641912d725576ce0439b60"],
  ["0.064 afwtdn@clean profile 1;0.128 afwtdn@clean profile 0;0.192 afwtdn@clean sigma 0", 2,
    "28d2a3221ded60d247eb194daf9f655f2c120673e7211e23b64203fb96b96cb7"],
  ["0 afwtdn@clean adaptive 1;0.064 afwtdn@clean adaptive 0;0.128 afwtdn@clean adaptive 1", 2,
    "ffb48b0572a461008165c7f5e0f770c71cb9850a0156fc428037da4d8f983bdb"],
  ["0.064 afwtdn@clean profile on;0.128 afwtdn@clean profile off;0.192 afwtdn@clean profile on", 1,
    "d09f86b902bd75ed542cc27610875fae9f08ff433863e11a736ee3dcbcddf13c"],
  ["0.064 afwtdn@clean sigma min;0.128 afwtdn@clean sigma 2", 1, midstreamBypass],
  ["0.064 afwtdn@clean softness min;0.128 afwtdn@clean softness bogus", 1,
    "dc0455acf66b4a34fade627345d3f976f77ce89767e2f83e3233179b950d806b"],
  ["0 afwtdn@clean adaptive yes;0.128 afwtdn@clean adaptive 1.0", 1, bypass]
] as const) it(`matches native repeated afwtdn commands: ${commands} (graph=${graph}, channels=${channels})`, async () => {
  const actual = await run(`asendcmd=c='${commands}',${filter.replace("afwtdn=", "afwtdn@clean=")}`, graph, channels);
  assert.equal(createHash("sha256").update(actual).digest("hex"), hash);
});

async function run(filters: string, graph: boolean, channels = 1) {
  const bytes = Buffer.alloc(input.length * channels);
  for (let i = 0; i < input.length / 2; i++) for (let c = 0; c < channels; c++) {
    bytes.writeInt16LE(input.readInt16LE(c === 0 ? i * 2 : input.length - 2 - i * 2), (i * channels + c) * 2);
  }
  const fs = Volume.fromJSON({ "/in.raw": bytes });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filters}[out]`, "-map", "[out]"] : ["-af", filters]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = fs.readFileSync("/out.raw") as Buffer;
  assert.equal(pcm.length, 5102 * channels);
  return pcm;
}
