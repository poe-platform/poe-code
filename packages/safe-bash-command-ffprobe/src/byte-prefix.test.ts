import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe 7.0.2: a tagged WAV with 4096 PCM bytes, 4166 bytes overall.
const bytes = Buffer.concat([
  Buffer.from("524946463e10000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c65006461746100100000", "hex"),
  Buffer.alloc(4096)
]);

for (const explicit of [false, true]) for (const prefix of [false, true]) for (const binary of [false, true]) {
  it(`formats byte counts (explicit=${explicit}, prefix=${prefix}, binary=${binary})`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/large.wav", bytes);
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []),
      ...(prefix ? ["-prefix"] : []), ...(binary ? ["-byte_binary_prefix"] : []),
      "-of", "default=nw=1", "-show_entries", "stream=sample_rate,duration:format=size", "/large.wav"];
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
    const expected = `sample_rate=${prefix ? "8 K" : "8000"}\nduration=0.256000\nsize=${prefix ? binary ? "4.068359 Ki" : "4.166000 K" : "4166"}\n`;
    expect(output).toBe(expected);
    expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
  });
}

for (const input of ["/large.wav", "-"]) for (const unit of [false, true]) {
  it(`preserves packet fields and composes prefixes with units (input=${input}, unit=${unit})`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/large.wav", bytes);
    for (const writer of ["json", "default", "csv", "compact", "flat", "ini", "xml"]) {
      const args = ["-v", "error", "-prefix", "-byte_binary_prefix", ...(unit ? ["-unit"] : []),
        "-max_size", "4096", "-of", writer, "-show_entries", "packet=pts,duration,duration_time,size,pos", input];
      let output = "", error = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe("");
      expect(result.exitCode).toBe(0);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(output);
      if (writer === "json") expect(JSON.parse(output)).toEqual({ packets: [{
        pts: 0, duration: 2048, duration_time: unit ? "0.256000 s" : "0.256000", size: unit ? "4 Kibyte" : "4 Ki", pos: "70"
      }] });
      else {
        expect(output).toContain(unit ? "4 Kibyte" : "4 Ki");
        expect(output).toContain(unit ? "0.256000 s" : "0.256000");
      }
    }
  });
}

it("limits binary scaling to byte fields and preserves timestamps, counters and tags", async () => {
  const { prefixRow } = await import("./probe-text.js");
  expect(prefixRow({ size: "1000", bit_rate: "8000", duration: "1024.000000", tags: { size: "4166" } }, "format", true))
    .toEqual({ size: "1000", bit_rate: "8 K", duration: "1.024000 K", tags: { size: "4166" } });
  expect(prefixRow({ sample_rate: "44100", bit_rate: "N/A", index: 1024, extradata_size: 2048 }, "stream", true))
    .toEqual({ sample_rate: "44.100000 K", bit_rate: "N/A", index: 1024, extradata_size: 2048 });
  expect(prefixRow({ size: "1048576", pts_time: "-1024.000000", dts_time: "0:00:00.000000", duration: 2048, pos: "4166" }, "packet", true, true))
    .toEqual({ size: "1 Mibyte", pts_time: "-1024.000000 s", dts_time: "0:00:00.000000", duration: 2048, pos: "4166" });
  expect(prefixRow({ pkt_size: "1073741824", width: 2048 }, "frame", true)).toEqual({ pkt_size: "1 Gi", width: 2048 });
  expect(prefixRow({ size: "1000000", duration: "0.000000" }, "format"))
    .toEqual({ size: "1 M", duration: "0.000000" });
});
