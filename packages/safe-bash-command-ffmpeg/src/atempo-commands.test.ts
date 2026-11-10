import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output, including the audio before the update.
for (const [filter, samples, hash] of [
  ["asendcmd=c='0.129 atempo@x tempo 1.5',atempo@x=1", 3072, "995e8b725e1220f0c6db27439dd2b8269b6631935bede536b21659d23612d3bd"],
  ["asendcmd=c='0 atempo@x tempo 1.5',atempo@x=1", 2816, "8cfd1981cd73c8f8665e88ffe14d3a8edc79a16cf339be0c4a86d70ac082ae25"],
  ["asendcmd=c='0.128 atempo@x tempo invalid;0.256 atempo@x tempo 0.25',atempo@x=1", 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"],
  ["asendcmd=c='0.128 atempo@x tempo 1.5;0.256 atempo@x tempo invalid;0.384 atempo@x tempo 0.75',atempo@x=1", 3936, "b569d1023d50b11ce49c69607d025bc7412f0694b3b8f19844cda589709400d9"],
  ["asendcmd=c='0.128 atempo tempo 1.5',atempo@first=1,atempo@second=1", 2944, "f74f4fb4ab11ca74953c1c038d495eecc4ffca68377b7539faf8c5f25d254123"],
  ["asendcmd=c='0.128 atempo@second tempo 1.5',atempo@first=1,atempo@second=1", 2816, "6e264e7066fa40e8ead394d12139d151c6d7469405207058fd6db002b766e7a6"],
  ["asetnsamples=n=200:p=0,asendcmd=c='0.128 atempo@x tempo 3/2',atempo@x=1", 3072, "2d1d9bac009ef58d35d6687a4e45d26203be8c41b69d14bbde261cb2e41f2509"],
  ["asetpts=PTS+8000,asendcmd=commands='1.128 [enter] atempo@x tempo 3/4',atempo@x=1", 5216, "0d0629dc7928c3034c5a3cd3fbcbb74208ffba7b110185df755c6dd81a222667"],
  ["asendcmd=c='0.128 atempo@x tempo 0.75',atempo@x=1.5", 5088, "ff740903cefc60110772f54685e5ddd20324ad1223f784cc10464735e1981753"],
  ["asendcmd=c='0.128 atempo@x tempo 1.5',atempo@x=1,aselect='eq(n,2)'", 341, "65648676fc2fa066ee273d651de84c6ca4b6353fcc920766dd9a29444fd9c12c"],
  ["asendcmd=c='0.128 atempo@x tempo 1.5',atempo@x=1", 2944, "5575b6c7101a0c86e5bc92646872aa80522e7e20fbb7c5c6db0efbb0f9eea24e"],
  ["asendcmd=c='0.128 atempo tempo 0.75',atempo=1", 5216, "0d0629dc7928c3034c5a3cd3fbcbb74208ffba7b110185df755c6dd81a222667"],
  ["asendcmd=c='0.128 atempo@other tempo 1.5',atempo@x=1", 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"],
  ["atempo@x=1", 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"],
  ["atempo=1", 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"]
] as const) {
  for (const complex of [false, true]) it(`scheduled tempo matches native PCM (${complex ? "complex" : "simple"}): ${filter}`, async () => {
    const input = Buffer.alloc(4096 * 2);
    for (let i = 0; i < 4096; i++) input.writeInt16LE(((i % 32) - 16) * 800, i * 2);
    const output = await run(filter, complex, input);
    assert.equal(output.length / 2, samples);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

async function run(filter: string, complex: boolean, input: Buffer): Promise<Buffer> {
    const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
    const output = fs.readFileSync("/out.raw") as Buffer;
    return output;
}

it("ignores an absent target without changing static-tempo rounding", async () => {
  const input = Buffer.alloc(8000 * 2);
  for (let i = 0; i < 8000; i++) input.writeInt16LE(12000 + i % 50, i * 2);
  const control = await run("atempo@x=1", false, input);
  const output = await run("asendcmd=c='0.128 atempo@other tempo 1.5',atempo@x=1", false, input);
  assert.deepEqual(output, control);
});
