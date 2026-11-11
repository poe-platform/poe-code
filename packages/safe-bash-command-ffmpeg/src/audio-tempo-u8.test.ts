import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references: 64 mono samples at 1000 Hz.
for (const [format, pattern, filter, hash] of [
  ["u8", "flat", "atempo=1", "a7e4b0966a99120c444f15dbeef1603841932165575ddd685ffa658f3f75cc47"],
  ["u8", "ramp", "atempo=1", "61fe1229dd0ba0d143a617c2e810992818c09ea9cedb6c38b1067dc31b403c18"],
  ["u8", "flat", "anull", "8667e718294e9e0df1d30600ba3eeb201f764aad2dad72748643e4a285e1d1f7"],
  ["s16le", "ramp", "atempo=1", "2b9c05553fec9cd139f656583c710b6d35396cd4540e5b5e0e87103c64437104"]
] as const) {
  for (const graph of [false, true]) {
    for (const scheduled of [false, true]) {
      it(`matches native ${format} ${pattern} ${filter} (graph=${graph}, scheduled=${scheduled})`, async () => {
        const input = Buffer.alloc(64 * (format === "u8" ? 1 : 2));
        for (let i = 0; i < 64; i++) {
          if (format === "u8") input[i] = pattern === "flat" ? 255 : (i % 17 - 8) * 4 + 128;
          else input.writeInt16LE((i % 17 - 8) * 1024, i * 2);
        }
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        const filters = (scheduled ? "asendcmd=c='0 atempo tempo 1'," : "") + filter;
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", format, "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filters}[out]`, "-map", "[out]"] : ["-af", filters]),
            "-f", format, "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { output.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        assert.equal(result.exitCode, 0, stderr);
        const bytes = Buffer.concat(output);
        assert.equal(bytes.length, input.length);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}
