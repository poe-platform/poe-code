import { expect, it } from "vitest";
import { wavAst } from "@poe-code/mp4-ast";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe, formatFfprobeResult } from "./media.js";

for (const explicit of [false, true]) {
  for (const section of ["packet", "frame", "stream", "format"]) {
    for (const sexagesimal of [false, true]) {
      it(`formats ${section} timestamps (explicit=${explicit}, sexagesimal=${sexagesimal})`, async () => {
        const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
        const args = ["-v", "error", "-of", "json", ...(explicit ? ["-f", "wav"] : []),
          ...(sexagesimal ? ["-sexagesimal"] : []), "-show_entries",
          `${section}=pts,pts_time,duration,duration_time`, "/input.wav"];
        const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
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
        const expected = section === "packet" || section === "frame"
          ? { pts: 0, pts_time: sexagesimal ? "0:00:00.000000" : "0.000000", duration: 16,
              duration_time: sexagesimal ? "0:00:00.002000" : "0.002000" }
          : { duration: sexagesimal ? "0:00:00.002000" : "0.002000" };
        for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
          const data = JSON.parse(text);
          expect(section === "format" ? data.format : data[section + "s"][0]).toEqual(expected);
        }
      });
    }
  }
}

for (const printFormat of ["json", "csv", "compact", "default", "flat", "ini"]) {
  it(`formats signed and long timestamps through ${printFormat} without altering ticks or tags`, () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    const probe = wavAst().probe(bytes, { showPackets: true });
    const row = { ...probe.packets![0]!, pts: -1024, pts_time: "-0.128000", dts_time: "3661.123456", duration_time: "N/A", size: "32" };
    const output = formatFfprobeResult({ ...probe, packets: [row] }, {
      printFormat, sexagesimal: true, showPackets: true, showFrames: false, showStreams: false,
      showFormat: false, showChapters: false, showPrograms: false
    });
    const rendered = printFormat === "ini" ? output.replaceAll("\\:", ":") : output;
    expect(rendered).toContain("-0:00:00.128000");
    expect(rendered).toContain("1:01:01.123456");
    expect(rendered).toContain("N/A");
    expect(rendered).toContain("-1024");
    expect(row.pts_time).toBe("-0.128000");
    const combined = JSON.parse(evalSyncFfprobe(undefined, ["-sexagesimal", "-unit", "-of", "json", "-show_entries", "packet=pts_time,size", "/input.wav"], () => bytes)!);
    expect(combined.packets).toEqual([{ pts_time: "0:00:00.000000", size: "32 byte" }]);
  });
}
