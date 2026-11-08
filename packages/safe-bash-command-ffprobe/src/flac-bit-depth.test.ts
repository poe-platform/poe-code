import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const bits of [16, 24]) for (const file of [false, true]) {
  it(`reports ${bits}-bit FLAC raw sample depth via ${file ? "file" : "stdin"}`, async () => {
    const bytes = new Uint8Array(42);
    bytes.set(new TextEncoder().encode("fLaC"));
    bytes.set([128, 0, 0, 34], 4);
    new DataView(bytes.buffer).setBigUint64(18, (8000n << 44n) | (BigInt(bits - 1) << 36n) | 2000n);
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile("/input.flac", bytes);
    for (const selection of [["-show_streams"], ["-show_entries", "stream=bits_per_sample,bits_per_raw_sample"]]) {
      const args = ["-v", "quiet", ...selection, "-of", "json", file ? "/input.flac" : "-"];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const expected = { bits_per_sample: 0, bits_per_raw_sample: String(bits) };
      expect(JSON.parse(output).streams[0]).toMatchObject(expected);
      if (selection[0] === "-show_entries") expect(JSON.parse(output).streams).toEqual([expected]);
      expect(output).toBe(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes));
    }
  });
}
