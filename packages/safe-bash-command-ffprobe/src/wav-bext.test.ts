import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
  bytes.set(new TextEncoder().encode(id));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

for (const info of [false, true]) {
  for (const reference of [4294967301n, 18446744073709551615n]) {
    it(`preserves Broadcast WAV tags with INFO=${info} and time reference ${reference}`, async () => {
      const bext = new Uint8Array(606);
      for (const [offset, value] of [[0, "TakeOne"], [256, "StudioA"], [288, "ABC"], [320, "2025-01-02"], [330, "03:04:05"], [602, "PCM"]] as const) {
        bext.set(new TextEncoder().encode(value), offset);
      }
      new DataView(bext.buffer).setBigUint64(338, reference, true);
      const plain = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
      const list = chunk("LIST", Uint8Array.of(...new TextEncoder().encode("INFO"), ...chunk("ISFT", new TextEncoder().encode("Encoder\0"))));
      const bytes = Uint8Array.of(...plain, ...chunk("bext", bext), ...(info ? list : []));
      new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
      const expected = {
        comment: "TakeOne", encoded_by: "StudioA", originator_reference: "ABC",
        date: "2025-01-02", creation_time: "03:04:05", time_reference: reference.toString(), coding_history: "PCM",
        ...(info ? { encoder: "Encoder" } : {})
      };
      expect(wavAst().probe(bytes).format.tags).toEqual(expected);
      expect((await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + Math.min(length, 7)); } })).format.tags).toEqual(expected);
      expect((await probeWavStream((async function* () {
        for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
      })())).format.tags).toEqual(expected);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.wav", bytes);
      for (const target of ["/input.wav", "-"]) {
        const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json", target];
        let output = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(output).format.tags).toEqual(expected);
        expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).format.tags).toEqual(expected);
      }
    });
  }
}
