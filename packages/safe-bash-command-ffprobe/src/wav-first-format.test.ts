import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./media.js";

// Original repeated-format fixture: mono PCM16 at 8000 Hz, then 16000 Hz.
const twice = Buffer.from("524946464400000057415645666d74201000000001000100401f0000803e000002001000666d74201000000001000100803e0000007d00000200100064617461080000006500660067006800", "hex");
const late = Buffer.from("524946465200000057415645666d74201000000001000100401f0000803e00000200100064617461080000006500660067006800666d74201000000001000100803e0000007d00000200100064617461060000000bfe0afe09fe", "hex");
const pcmFirst = Buffer.from(twice);
pcmFirst.writeUInt16LE(7, 44); pcmFirst.writeUInt32LE(16000, 52);
pcmFirst.writeUInt16LE(1, 56); pcmFirst.writeUInt16LE(8, 58);
Buffer.from("ffff000080808181", "hex").copy(pcmFirst, 68);
const mulawFirst = Buffer.from(pcmFirst);
pcmFirst.copy(mulawFirst, 20, 44, 60); pcmFirst.copy(mulawFirst, 44, 20, 36);

for (const [name, input, rate, codec, samples] of [
  ["repeated PCM", twice, 8000, "pcm_s16le", [101, 102, 103, 104]],
  ["format between data chunks", late, 8000, "pcm_s16le", [-501, -502, -503]],
  ["PCM before mulaw", pcmFirst, 8000, "pcm_s16le", [-1, 0, -32640, -32383]],
  ["mulaw before PCM", mulawFirst, 16000, "pcm_mulaw", [0, 0, -32124, -32124, 32124, 32124, 31100, 31100]]
] as const) for (const pipe of [false, true]) {
  it(`keeps the first format for ${name} through ${pipe ? "stdin" : "a file"}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.wav", input);
    for (const mode of ["metadata", "packets", "wav", "raw"] as const) {
      const probe = mode === "metadata" || mode === "packets";
      let stdout = "", stderr = "";
      const args = probe
        ? ["-v", "error", ...(mode === "packets" ? ["-show_packets"] : []), "-show_entries", "stream=codec_name,sample_rate", "-of", "json", pipe ? "pipe:0" : "/in.wav"]
        : ["-y", "-v", "error", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "pcm_s16le", "-f", mode === "wav" ? "wav" : "s16le", "/out"];
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        command: probe ? "ffprobe" : "ffmpeg", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (pipe) for (let offset = 0; offset < input.length; offset += 3) yield input.subarray(offset, offset + 3); })(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      if (probe) {
        expect(JSON.parse(stdout).streams[0]).toMatchObject({ sample_rate: String(rate), codec_name: codec });
      } else {
        const output = Buffer.from(await fs.readFile("/out"));
        let data = output;
        if (mode === "wav") {
          let format: Buffer | undefined;
          for (let offset = 12; offset + 8 <= output.length;) {
            const size = output.readUInt32LE(offset + 4), id = output.toString("ascii", offset, offset + 4);
            const chunk = output.subarray(offset + 8, offset + 8 + size);
            if (id === "fmt ") format = chunk;
            if (id === "data") data = chunk;
            offset += 8 + size + size % 2;
          }
          expect(format?.readUInt32LE(4)).toBe(rate);
          expect(format?.readUInt16LE(0)).toBe(1);
        }
        // Native pipes consume both data chunks; seekable files select the last.
        const expected = pipe && input === late ? [101, 102, 103, 104, ...samples] : samples;
        expect(Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2))).toEqual(expected);
      }
    }
  });
}
