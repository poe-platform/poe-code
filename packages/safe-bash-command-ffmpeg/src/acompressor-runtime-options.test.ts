import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for static, time-zero and frame-32 updates.
const references = [
  ["mix", "0.25", "7bffe6afe198f8a55f676cbaa20d4efc7d5bd558f201f33f0f0d7d7ccc61e511", "074907caf293779b012be3afb640d94967d314cbe429c27e147ffc29c83439eb"],
  ["level_in", "0.5", "f27a07118069d27c3e2d964bd469d6ce41a0ea4fa44330f08b5cff291e3789c8", "e7b3d811442d66f0ac5691d833b24dd8ac8057f1bd61d91fa37cbfa0574cae8f"],
  ["threshold", "0.04", "7b7ec9f5d50fa76c1ab448b3b75d08bfd49769af650b498788131fa049b9c37d", "84d5e5be6d5a746f6780bed5a2de5466143b0bdd340398e54d0b321651959894"],
  ["knee", "8", "ba85c834a4e628a8bf4731b30c940c3d255b3a4a96ef9047a523270ab1f1b23e", "df81ef3df07076d9c53961102f27893101f3d0ed8f3844c0c75dfb2443604c16"],
  ["mode", "upward", "e6a9b540b6e817fe65be895860e17551c20adea509ae6b4b6da4725f782ab03c", "bd1bd3cd46fffb6051c1c675fec076fe572634930ea622e62b507b325f77f243"],
  ["link", "maximum", "3f3e72cfd4178970fb9134f73f72bb2c2e6a26f416635d6a8b960c16a321e38c", "8cfd04247fd57518b43b6fd695b02726fe973f86506da1a20ded98ce98d9474c"],
  ["detection", "peak", "80e2b2bc1db3112d19adcb06f4817b7104a66de901fd138f9f211259796be4f0", "aa5617bf81af0add9cd40b47060abaf2b09a22a72590a2fd392d2bf2fa05f641"],
  ["attack", "0.1", "2768f63745e940eeefb549269ef4700c253f6819716766e9c9163a86a4263c24", "c027d4868b8300a33660853d556e2ec28b0fb993e86c372d29a2c9a9a3b69485"],
  ["release", "2", "740fed9a7091fe0d5ce2a6982b63e73649ca68509be48d8fdb83b05b39b16608", "d29b2cbec0105cc81add8e72b1b32cdbad9f408d89053545ec943b16f797383e"]
] as const;

for (const graph of [false, true]) {
  for (const [key, value, fixed, timed] of references) {
    for (const time of ["static", "0", "0.004"]) {
      it(`acompressor ${key} at ${time} matches native (${graph ? "graph" : "simple"})`, async () => {
        const command = time === "static" ? "" : `${time} acompressor@c ${key} ${value}`;
        assert.equal(await run(command, time === "static" ? `:${key}=${value}` : "", graph), time === "0.004" ? timed : fixed);
      });
    }
    it(`acompressor ${key} retains settings after rejected updates (${graph ? "graph" : "simple"})`, async () => {
      assert.equal(await run(`0 acompressor@c ${key} ${value};0.004 acompressor@c ${key} invalid`, "", graph), fixed);
      assert.equal(await run(`0 acompressor@c ${key} invalid;0.004 acompressor@c ${key} ${value}`, "", graph), timed);
    });
  }
}

async function run(command: string, options: string, graph: boolean): Promise<string> {
  const input = Buffer.alloc(256);
  const samples = [30000, 300, 22000, -400, -17000, 500, 16000, -600, 1000, 700, -1800, 600, 2000, -900, 2000, 700];
  for (let i = 0; i < 128; i++) input.writeInt16LE(samples[i % samples.length]!, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chain = `asetnsamples=n=8:p=0,${command ? `asendcmd=c='${command}',` : ""}acompressor@c=threshold=0.125:attack=5:release=40${options}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = Buffer.concat(output);
  assert.equal(pcm.length, 256);
  return createHash("sha256").update(pcm).digest("hex");
}
