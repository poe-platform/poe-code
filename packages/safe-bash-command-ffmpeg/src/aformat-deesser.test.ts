import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for the input below at 44100 Hz.
for (const [layout, channels, floating, integer] of [
  ["mono", 1, "5a81f7b3ab5b4ba5d986e7272f0033166724bf4046ff4515e638b3371f0800ed", "3a2fc0639421167db8656b952fa8522c1c10149accd71612d561a9481656a9f5"],
  ["quad", 4, "e68eead06649b78900358a33af7ecc22d9ef2975ff4446d4d95d1786417142f0", "ede83d26e64f3ab73a00d7403aaacebebc56ca0a1288f213ee22c962fce85855"],
  ["5.1", 6, "0a70423a5ccc0a457da7ca6360f45b8d71542c4d458136ad49debbb9e627dd68", "374893547cade1ca2a69f51c4d831563c3748ab75db8ee5634cfda214bf63056"],
  ["stereo", 2, "ea5ecf337ee48c98b38836befaa235406cd67c9ba4c69cc56e0bbfbb01f7bac7", "ea5ecf337ee48c98b38836befaa235406cd67c9ba4c69cc56e0bbfbb01f7bac7"]
] as const) {
  for (const [format, target, expected] of [
    ["channel_layouts=stereo", "deesser", floating],
    ["cl=stereo", "deesser@voice", floating],
    ["channel_layouts=stereo:sample_fmts=dblp", "deesser", floating],
    ["channel_layouts=stereo:sample_fmts=s16", "deesser", integer]
  ] as const) {
    for (const graph of [false, true]) {
      it(`negotiates ${layout} aformat=${format} before ${target} (graph=${graph})`, async () => {
        const input = Buffer.alloc(4800);
        for (let i = 0; i < 2400; i++) {
          input.writeInt16LE((i % 5 < 2 ? -1 : 1) * 5000 + (i * 301 % 6001 - 3000), i * 2);
        }
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        const filter = `aformat=${format},${target}=i=0.75:m=0.3:f=0.4:s=e`;
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ch_layout", layout, "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(stdout);
        assert.equal(output.length, 9600 / channels);
        assert.equal(createHash("sha256").update(output).digest("hex"), expected);
      });
    }
  }
}
