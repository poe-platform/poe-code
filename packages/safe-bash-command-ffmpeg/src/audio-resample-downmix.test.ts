import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, interleaved PCM16: (i * 997) % 60001 - 30000.
for (const [rate, channels, filter, length, hash] of [
  [44100, 4, "earwax", 768, "f83fa86c99cb39fe0e74ad4d6397bcd2afaeeae4f0360083fbdf8f665698cec8"],
  [44100, 6, "earwax", 512, "eb045686431a6b4ad66f30d55c5ceaaac6287d853c545df404a12dcd32b8aff8"],
  [48000, 2, "earwax", 1412, "ff757e94cf06943ec007a24532aba6430d3fe68404aec905c6fde4b7c8008bc8"],
  [48000, 4, "earwax", 708, "91d03d86620e24b69ce34521ca73454205ba73ded6b2d538e0bac973152826ec"],
  [48000, 6, "earwax", 468, "3c88b2a7cb05c5762da0423d88bd36befe0ff95b5c2eec061c8c2b142eaa4dac"],
  [8000, 4, "earwax", 4236, "78df4f414ca42941e2513b1b8738a56becec44da3c46059677dc37af947acd20"],
  [48000, 4, "aformat=channel_layouts=stereo", 768, "9dc7a4ed6456d8d28f4a28818caed38f19b4d85247e8a4001b3c4ea68cd0ae00"],
  [48000, 4, "aresample=44100:ochl=stereo", 708, "2c1995931c67f7945c935e0bceb16b7cfe30b10ba7a25fc5eff394b94805a073"],
  [48000, 4, "aresample=44100:ochl=stereo:osf=s16", 708, "2c1995931c67f7945c935e0bceb16b7cfe30b10ba7a25fc5eff394b94805a073"],
  [48000, 4, "aformat=channel_layouts=stereo:sample_rates=44100", 708, "2c1995931c67f7945c935e0bceb16b7cfe30b10ba7a25fc5eff394b94805a073"],
  [48000, 4, "aformat=sample_fmts=s16:channel_layouts=stereo:sample_rates=44100", 708, "2c1995931c67f7945c935e0bceb16b7cfe30b10ba7a25fc5eff394b94805a073"],
  [48000, 4, "aformat=sample_rates=44100:channel_layouts=stereo", 708, "2c1995931c67f7945c935e0bceb16b7cfe30b10ba7a25fc5eff394b94805a073"],
  [48000, 4, "aresample=44100,earwax", 708, "91d03d86620e24b69ce34521ca73454205ba73ded6b2d538e0bac973152826ec"]
] as const) {
  for (const complex of [false, true]) {
    it(`${filter} converts ${channels} channels at ${rate} Hz (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(768 * 2);
      for (let i = 0; i < 768; i++) input.writeInt16LE((i * 997) % 60001 - 30000, i * 2);
      const volume = new Volume();
      volume.writeFileSync("/in.pcm", input);
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", String(channels), "-i", "/in.pcm",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[a]`, "-map", "[a]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const bytes = Buffer.concat(output);
      assert.equal(bytes.length, length);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    });
  }
}
