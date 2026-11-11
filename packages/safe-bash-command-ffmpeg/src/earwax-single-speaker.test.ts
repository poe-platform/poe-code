import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 treats each labeled single speaker as mono for earwax.
for (const layout of ["FC", "FL", "FR", "LFE", "SL", "BC", "FL,aformat=channel_layouts=stereo"]) {
  for (const complex of [false, true]) {
    it(`earwax negotiates a single speaker ${layout} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(768 * 2);
      for (let i = 0; i < 768; i++) input.writeInt16LE((i * 997) % 60001 - 30000, i * 2);
      const volume = new Volume();
      volume.writeFileSync("/in.pcm", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const filter = `channelmap=0:${layout},earwax`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "1", "-i", "/in.pcm",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[a]`, "-map", "[a]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, 3072);
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "09fa9f25d8ff425eb1ce153d6f0b96a922f48bcc23c53d06e2ec2b53775ecdcd");
    });
  }
}
