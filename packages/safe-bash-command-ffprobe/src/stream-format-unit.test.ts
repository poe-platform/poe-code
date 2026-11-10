import { expect, it } from "vitest";
import { wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe, formatFfprobeResult } from "./media.js";

// Native ffprobe: sample_rate=8000 Hz, duration=0.256000 s, size=4166 byte.
const bytes = new Uint8Array(Buffer.concat([
  Buffer.from("524946463e10000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c65006461746100100000", "hex"),
  Buffer.alloc(4096)
]));

for (const unit of [false, true]) for (const sexagesimal of [false, true]) {
  it(`formats stream and container units=${unit}, sexagesimal=${sexagesimal}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/large.wav", bytes);
    const duration = sexagesimal ? "0:00:00.256000" : `0.256000${unit ? " s" : ""}`;
    const sampleRate = `8000${unit ? " Hz" : ""}`;
    const size = `4166${unit ? " byte" : ""}`;
    for (const writer of ["default=nw=1", "json", "csv", "compact", "flat", "ini", "xml"]) {
      const args = ["-v", "error", ...(unit ? ["-unit"] : []), ...(sexagesimal ? ["-sexagesimal"] : []),
        "-of", writer, "-show_entries", "stream=sample_rate,duration:format=size", "/large.wav"];
      let output = "", error = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe("");
      expect(result.exitCode).toBe(0);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(output);
      if (writer === "default=nw=1") expect(output).toBe(`sample_rate=${sampleRate}\nduration=${duration}\nsize=${size}\n`);
      else if (writer === "json") expect(JSON.parse(output)).toMatchObject({
        streams: [{ sample_rate: sampleRate, duration }], format: { size }
      });
      else for (const value of [sampleRate, duration, size]) expect(output).toContain(writer === "ini" ? value.replaceAll(":", "\\:") : value);
    }
  });
}

it("keeps unavailable values, ticks and tags unchanged while adding metadata units", () => {
  const probe = wavAst().probe(bytes);
  const output = formatFfprobeResult({
    ...probe,
    streams: [{ ...probe.streams[0]!, index: 0, codec_type: "audio", sample_rate: "8000", bit_rate: "128000",
      start_time: "-0.125000", duration: "N/A", duration_ts: 2048, tags: { duration: "title" } }],
    format: { ...probe.format!, filename: "large.wav", nb_streams: 1, format_name: "wav", duration: "0.256000",
      start_time: "0.000000", size: "4166", bit_rate: "130187", tags: { size: "label" } }
  }, { printFormat: "json", showOptionalFields: "always", unit: true, showStreams: true, showFormat: true,
    showPackets: false, showFrames: false, showChapters: false, showPrograms: false });
  expect(JSON.parse(output)).toMatchObject({
    streams: [{ sample_rate: "8000 Hz", bit_rate: "128000 bit/s",
      start_time: "-0.125000 s", duration: "N/A", duration_ts: 2048, tags: { duration: "title" } }],
    format: { duration: "0.256000 s", start_time: "0.000000 s", size: "4166 byte", bit_rate: "130187 bit/s", tags: { size: "label" } }
  });
});
