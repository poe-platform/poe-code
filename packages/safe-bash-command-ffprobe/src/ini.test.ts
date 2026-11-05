import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe, formatFfprobeSourceChunks } from "./media.js";

const bytes = encodeWav({ sampleRate: 16000, channels: [new Float64Array(2000)] });
for (const explicit of [false, true]) for (const file of [false, true]) for (const writer of ["ini", "ini=h=0", "ini=hierarchical=0"]) {
  it(`writes native INI through ${explicit ? "media" : "audio"} ${file ? "file" : "stdin"} with ${writer}`, async () => {
    const args = [...(explicit ? ["-f", "wav"] : []), "-show_entries", "stream=index,codec_name,sample_rate,channels", "-of", writer, "-i", file ? "/in.wav" : "-"];
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile("/in.wav", bytes);
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    const expected = `# ffprobe output\n\n\n\n[${writer === "ini" ? "streams." : ""}stream.0]\nindex=0\ncodec_name=pcm_s16le\nsample_rate=16000\nchannels=1\n`;
    expect(result.exitCode, stderr).toBe(0);
    expect(stdout).toBe(expected);
    expect(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)).toBe(expected);
  });
}

it("escapes streamed INI tags and preserves nested sections and chapter indices", async () => {
  const value = 'é😀=:#;\\\n\r\t\b\f"';
  const text = { kind: "text" as const, *chunks() { yield value.slice(0, 2); yield value.slice(2); } };
  const chapter = { id: 0, time_base: "1/1000", start: 0, start_time: "0", end: 1, end_time: "0.001", tags: { title: text } };
  let output = "";
  for await (const part of formatFfprobeSourceChunks({ streams: [], chapters: [chapter, { ...chapter, id: 1 }], format: {
    filename: "input.wav", nb_streams: 0, nb_programs: 0, nb_stream_groups: 0,
    format_name: "wav", format_long_name: "WAV / WAVE (Waveform Audio)",
    start_time: "0", duration: "0.125", size: String(bytes.length), bit_rate: "256000", probe_score: 99,
    tags: { "a=b#c": text }
  } }, {
    printFormat: "ini", showFormat: true, showStreams: false, showPackets: false, showFrames: false, showChapters: true, showPrograms: false
  })) output += part;
  expect(output).toContain('[chapters.chapter.0]\nid=0\n');
  expect(output).toContain('[chapters.chapter.1]\nid=1\n');
  expect(output).toContain('[chapters.chapter.0.tags]\ntitle=é😀\\=\\:\\#;\\\\\\n\\r\\t\\b\\f"\n');
  expect(output).toContain('[format.tags]\na\\=b\\#c=é😀\\=\\:\\#;\\\\\\n\\r\\t\\b\\f"\n');
});

it("escapes native INI tag values through the public audio command", async () => {
  const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(8)] }, { tags: { title: 'é😀=:#;\\\n\r\t\b\f"\u0001\u001b' } });
  const args = ["-show_entries", "format_tags=title", "-print_format", "ini", "-i", "-"];
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield input; } },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, stderr).toBe(0);
  expect(stdout).toBe('# ffprobe output\n\n[format]\n[format.tags]\ntitle=é😀\\=\\:\\#;\\\\\\n\\r\\t\\b\\f"\\x0001\\x001b\n');
});
