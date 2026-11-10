import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { fadeAudio } from "./audio-fade.js";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for mono 8 kHz PCM16 with 3173 samples.
for (const [enable, hash] of [
  ["gte(pos\\,1000)", "138133b06195a99c9d0d19093bf5b94ca44bb148ada9faf41c678f80a7b5a437"],
  ["gte(n\\,1)", "138133b06195a99c9d0d19093bf5b94ca44bb148ada9faf41c678f80a7b5a437"],
  ["isnan(w)", "d538fd43f1cf91b4b48eb6df3e2527fbc63988e15eedd19befb4eb628af97587"],
  ["0", "d538fd43f1cf91b4b48eb6df3e2527fbc63988e15eedd19befb4eb628af97587"]
] as const) {
  for (const graph of [false, true]) it(`afade enable=${enable} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 3173 }, (_, i) => ((i * 179 % 50001) - 25000) / 32768)] }));
    const filter = `afade=ns=900:enable=${enable}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
        : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
    assert.equal(output.length, 6346);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const pos of [undefined, -1]) {
  for (const [enable, expected] of [
    ["isnan(pos)", [0, 0.25, 0.5, 0.75]],
    ["pos", [1, 1, 1, 1]],
    ["w", [1, 1, 1, 1]],
    ["eq(w,0)", [0, 0.25, 0.5, 0.75]]
  ] as const) it(`afade evaluates ${enable} with unavailable packet position ${pos}`, async () => {
    const output = await fadeAudio([new Float64Array(4).fill(1)], 8000,
      `afade=ns=4:enable='${enable}'`, [{ start: 0, end: 4, pts: 0, pos }], 0, [], new MediaBudgetTracker());
    assert.deepEqual(Array.from(output[0]!), expected);
  });
}
