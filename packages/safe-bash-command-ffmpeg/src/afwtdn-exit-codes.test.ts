import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: identical PCM16 input and raw s16le stdout.
const input = encodeWav({ sampleRate: 8000,
  channels: [Float64Array.from({ length: 1200 }, (_, i) => ((i * 13129) % 30001 - 15000) / 32768)] });
const base = "afwtdn=samples=512:levels=2:wavet=sym2:sigma=0.1";
for (const graph of [false, true]) for (const [suffix, exitCode] of [
  [":levels=13", 222], [":wavet=foo", 234], [":foo=1", 8], ["", 0]
] as const) it(`afwtdn returns native status for ${suffix || "valid options"} (graph=${graph})`, async () => {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", input);
  const stdout: Buffer[] = [];
  let stderr = "";
  const filter = base + suffix;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, exitCode, stderr);
  const pcm = Buffer.concat(stdout);
  assert.equal(pcm.length, exitCode === 0 ? 3054 : 0);
  if (exitCode === 0) {
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "2f2ba9f7bee86dd971296640edace24e1665063b4b55e640804c503b7b4de795");
  } else {
    assert.ok(stderr.includes("afwtdn:"), stderr);
  }
});
