import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { prefixRow } from "./probe-text.js";
import { evalSyncFfprobe } from "./media.js";

for (const explicit of [false, true]) for (const prefix of [false, true]) {
  it(`formats stream and container decimal prefixes (explicit=${explicit}, prefix=${prefix})`, async () => {
    const bytes = new Uint8Array(Buffer.concat([
      Buffer.from("524946463e10000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c65006461746100100000", "hex"),
      Buffer.alloc(4096)
    ]));
    const withUnits = JSON.parse(evalSyncFfprobe(undefined, ["-prefix", "-unit", "-of", "json",
      "-show_entries", "stream=sample_rate,duration:format=size", "/large.wav"], () => bytes)!);
    expect(withUnits).toMatchObject({ streams: [{ sample_rate: "8 KHz", duration: "0.256000 s" }],
      format: { size: "4.166000 Kbyte" } });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/large.wav", bytes);
    for (const writer of ["default=nw=1", "json", "csv", "compact", "flat", "ini", "xml"]) {
      const args = ["-v", "error", ...(prefix ? ["-prefix"] : []), ...(explicit ? ["-f", "wav"] : []),
        "-of", writer, "-show_entries", "stream=sample_rate,duration,bit_rate:format=size", "/large.wav"];
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
      expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(output);
      if (writer === "default=nw=1") expect(output).toBe(prefix
        ? "sample_rate=8 K\nduration=0.256000\nbit_rate=128 K\nsize=4.166000 K\n"
        : "sample_rate=8000\nduration=0.256000\nbit_rate=128000\nsize=4166\n");
      else {
        expect(output).toContain(prefix ? "8 K" : "8000");
        expect(output).toContain(prefix ? "4.166000 K" : "4166");
        expect(output).toContain("0.256000");
      }
    }
  });
}

it("scales measured values with units while preserving timestamps, counts and tags", () => {
  const row = { sample_rate: "44100 Hz", bit_rate: "128000 bit/s", max_bit_rate: "N/A",
    size: "4166 byte", duration: "1000.000000 s", start_time: "0:16:40.000000",
    duration_ts: 8000000, nb_frames: "1000", tags: { size: "4166" } };
  expect(prefixRow(row, "stream")).toEqual({ ...row, sample_rate: "44.100000 KHz",
    bit_rate: "128 Kbit/s", size: "4.166000 Kbyte", duration: "1.000000 Ks" });
  expect(row.size).toBe("4166 byte");
  expect(prefixRow(row, "stream_tags")).toBe(row);
  expect(prefixRow({ size: "999", bit_rate: "1000000", duration: "0.000001" }, "format"))
    .toEqual({ size: "999", bit_rate: "1 M", duration: "0.000001" });
});
