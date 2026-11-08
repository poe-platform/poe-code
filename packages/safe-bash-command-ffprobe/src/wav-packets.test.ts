import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const declaredSize of [0, 8, 16, 0xffffffff]) {
  for (const target of ["/input.wav", "-"]) {
    for (const format of [[], ["-f", "wav"]]) {
      it(`reports WAV packets with data size ${declaredSize} from ${target} ${format.join(" ")}`, async () => {
        const samples = [11, 22, 33, 44, -55, -66, -77, -88];
        const bytes = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(40, declaredSize, true);
        const args = ["-v", "error", ...format, "-show_packets", "-show_entries", "packet=pts,duration,size", "-of", "json", target];
        const duration = declaredSize === 8 ? 4 : 8;
        const expected = [{ pts: 0, duration, size: String(duration * 2) }];
        const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
        let output = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(output).packets).toEqual(expected);
        expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).packets).toEqual(expected);
      });
    }
  }
}

it.each(["file", "stdin", "count-only"])("reports native WAV packets and counted records for %s", async route => {
  const bytes = encodeWav({ sampleRate: 44100, channels: [new Float64Array(44100)] });
  const fs = new MemoryFileSystem(); await fs.writeFile("/tone.wav", bytes);
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe",
    ...createCommandArguments(["-v", "error", ...(route === "count-only" ? [] : ["-show_packets"]), "-count_packets", "-count_frames",
      "-show_entries", `${route === "count-only" ? "" : "packet=pts,duration,size:"}stream=nb_frames,nb_read_packets,nb_read_frames`,
      "-of", "json", route === "stdin" ? "-" : "/tone.wav"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output)).toEqual({
    programs: [], stream_groups: [],
    ...(route === "count-only" ? {} : { packets: Array.from({ length: 11 }, (_, index) => {
      const pts = index * 4096, duration = Math.min(4096, 44100 - pts);
      return { pts, duration, size: String(duration * 2) };
    }) }),
    streams: [{ nb_read_packets: "11", nb_read_frames: "11" }]
  });
});

for (const section of ["packet", "frame"]) {
  it(`reports the physical WAV ${section} position through async and sync commands`, async () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    const args = ["-v", "error", "-of", "json", "-show_entries",
      section === "packet" ? "packet=flags,pos,size,stream_index,pts,dts,duration" : "frame=pkt_pos,pkt_size", "/input.wav"];
    const expected = section === "packet"
      ? [{ flags: "K__", pos: "44", size: "32", stream_index: 0, pts: 0, dts: 0, duration: 16 }]
      : [{ pkt_pos: "44", pkt_size: "32" }];
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output)[`${section}s`]).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)[`${section}s`]).toEqual(expected);
  });
}
