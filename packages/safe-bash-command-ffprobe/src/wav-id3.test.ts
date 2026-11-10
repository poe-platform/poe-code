import { expect, it } from "vitest";
import { encodeId3, encodeWav } from "@poe-code/audio-ast";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import fixtures from "../../../tests/fixtures/media/wav-id3.json" with { type: "json" };

for (const [name, hex] of Object.entries(fixtures)) {
  it(`probes WAV ID3 text and chunk precedence through every input path: ${name}`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const expected = name === "before"
      ? { title: "RIFF title", artist: "RIFF artist" }
      : { title: "Title from ID3", artist: "Artist from ID3" };
    expect(wavAst().probe(bytes).format.tags).toEqual(expected);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
      expect(length).toBeLessThanOrEqual(16384);
      return bytes.subarray(offset, offset + Math.min(length, 3));
    } })).format.tags).toEqual(expected);
    expect((await probeWavStream((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 3) yield bytes.subarray(offset, offset + 3);
    })())).format.tags).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    for (const target of ["/input.wav", "-"]) for (const explicit of [false, true]) {
      const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-show_entries", "format_tags", "-of", "json", target];
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

for (const version of [3, 4] as const) {
  it(`reads long Unicode ID3v2.${version} text through bounded WAV ranges`, async () => {
    const tags = { title: "日本語 café ".repeat(2000), artist: "Björk" };
    const payload = encodeId3(tags, [], [], version);
    const chunk = Buffer.alloc(8 + payload.length + payload.length % 2);
    chunk.write("id3 "); chunk.writeUInt32LE(payload.length, 4); chunk.set(payload, 8);
    const bytes = Buffer.concat([encodeWav({ sampleRate: 8000, channels: [new Float64Array(4)] }), chunk]);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
      expect(length).toBeLessThanOrEqual(16384);
      return bytes.subarray(offset, offset + length);
    } })).format.tags).toEqual({ ...tags, title: tags.title.trimEnd() });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    let output = "";
    const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json", "/input.wav"];
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).format.tags).toEqual({ ...tags, title: tags.title.trimEnd() });
    const malformed = bytes.slice();
    malformed.writeUInt32BE(0x7f7f7f7f, bytes.length - chunk.length + 14);
    expect(() => wavAst().probe(malformed)).toThrow();
  });
}
