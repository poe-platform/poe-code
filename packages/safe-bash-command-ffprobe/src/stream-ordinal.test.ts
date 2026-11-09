import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { probeMp4, wavAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe, formatFfprobeResult, formatFfprobeSourceChunks } from "./media.js";
import { encodeWav } from "@poe-code/audio-ast";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));

for (const route of ["file", "stdin", "sync"]) {
  it.each(["1", "01", "0x1", "0X1", "a:1", "a:01", "a:0x1", "a:0X1"])(`selects stream one with %s via ${route}`, async selector => {
    const args = ["-v", "error", "-select_streams", selector, "-show_entries", "stream=index", "-of", "json", route === "stdin" ? "-" : "/tracks.mkv"];
    let output = "", diagnostic = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/tracks.mkv", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
    }
    expect(JSON.parse(output).streams).toEqual([{ index: 1 }]);
  });
}

it.each(["08", "a:08", "09", "a:09", "0x", "a:0X", "0xg", "a:0x1g", "1x", "a:1.0", "0b1", "a:0o1"])("rejects malformed ordinal %s without output", async selector => {
  const args = ["-v", "error", "-select_streams", selector, "-show_entries", "stream=index", "-of", "json", "/tracks.mkv"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tracks.mkv", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode).toBe(1);
  expect(output).toBe("");
  expect(diagnostic).toContain(`Invalid stream specifier: ${selector}`);
  expect(evalSyncFfprobe(undefined, args, () => bytes)).toBeUndefined();
});

const probe = probeMp4(readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url)), { showPackets: true });
const streams = Array.from({ length: 12 }, (_, index) => ({ ...probe.streams[1]!, index }));
const packets = streams.map(({ index }) => ({ ...probe.packets!.find(packet => packet.stream_index === 1)!, stream_index: index }));

it.each([
  ["010", 8], ["a:010", 8], ["0x8", 8], ["a:0X8", 8], ["8", 8], ["a:8", 8],
  ["012", 10], ["a:012", 10], ["0xa", 10], ["a:0XA", 10],
] as const)("selects the same stream and packets with %s", async (selector, index) => {
  const options = { printFormat: "json", selectStreams: selector, showEntries: "stream=index:packet=stream_index", showStreams: true, showPackets: true,
    showFormat: false, showFrames: false, showChapters: false, showPrograms: false };
  const data = { ...probe, streams, packets };
  const expected = { packets: [{ stream_index: index }], streams: [{ index }] };
  expect(JSON.parse(formatFfprobeResult(data, options))).toMatchObject(expected);
  async function* rows<T>(values: T[]) { yield* values; }
  let output = "";
  for await (const chunk of formatFfprobeSourceChunks({ ...data, streams: rows(streams), packets: rows(packets) }, options)) output += chunk;
  expect(JSON.parse(output)).toMatchObject(expected);

  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }));
  output = "";
  let diagnostic = "";
  const result = await createFfprobeCommand({ asts: [{ ...wavAst(), async probeRecords() {
    return { ...data, streams: rows(streams), packets: rows(packets) };
  } }] }).execute({
    command: "ffprobe", ...createCommandArguments(["-select_streams", selector, "-read_intervals", "%+#1", "-count_packets",
      "-show_entries", "stream=index,nb_read_packets:packet=stream_index:packet_side_data=", "-of", "json", "/input.wav"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ packets: [{ stream_index: index }], streams: [{ index, nb_read_packets: "1" }] });
});
