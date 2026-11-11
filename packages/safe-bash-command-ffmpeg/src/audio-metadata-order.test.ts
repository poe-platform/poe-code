import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const header = "frame:0    pts:0       pts_time:0\n";

async function printTags(filter: string, pcm: Buffer = Buffer.from("00000000d00700000000", "hex"), channels = 1) {
  const volume = Volume.fromJSON({ "/in.raw": pcm });
  let stdout = "";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", String(channels), "-i", "/in.raw",
      "-af", `${filter},ametadata=print:file=-`, "-f", "null", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return stdout;
}

// FFmpeg replaces a removed dictionary entry with the last entry, then appends a replacement.
for (const [edit, expected] of [
  ["", "a=1\nb=2\nc=3\n"],
  [",ametadata=modify:a:4", "c=3\nb=2\na=4\n"],
  [",ametadata=modify:a:1", "c=3\nb=2\na=1\n"],
  [",ametadata=modify:b:4", "a=1\nc=3\nb=4\n"],
  [",ametadata=modify:c:4", "a=1\nb=2\nc=4\n"],
  [",ametadata=delete:a", "c=3\nb=2\n"],
  [",ametadata=delete:b", "a=1\nc=3\n"],
  [",ametadata=delete:c", "a=1\nb=2\n"],
  [",ametadata=delete:a:wrong", "a=1\nb=2\nc=3\n"],
  [",ametadata=modify:missing:4", "a=1\nb=2\nc=3\n"],
  [",ametadata=delete:missing", "a=1\nb=2\nc=3\n"],
  [",ametadata=add:a:4", "a=1\nb=2\nc=3\n"],
  [",ametadata=delete:a,ametadata=add:a:4,ametadata=modify:c:5", "a=4\nb=2\nc=5\n"],
  [",ametadata=delete", ""]
] as const) {
  it(`prints native tag order after ${edit || "add only"}`, async () => {
    assert.equal(await printTags(`ametadata=add:a:1,ametadata=add:b:2,ametadata=add:c:3${edit}`),
      expected ? header + expected : "");
  });
}

for (const [pcm, expected] of [
  ["00000000d007", "lavfi.silence_start=0\nlavfi.silence_end=0.002\nlavfi.silence_duration=0.002\n"],
  ["00000000d00700000000", "lavfi.silence_duration=0.002\nlavfi.silence_end=0.002\nlavfi.silence_start=0.003\n"]
] as const) {
  it(`prints native silencedetect tag order for ${pcm.length / 4} samples`, async () => {
    assert.equal(await printTags("silencedetect=noise=0.01:d=0.002", Buffer.from(pcm, "hex")), header + expected);
  });
}

for (const [key, filter, expected, channels, samples] of [
  ["lavfi.aphasemeter.phase", "aphasemeter=video=0", "lavfi.aphasemeter.phase=1.000000\n", 2, 5],
  ["lavfi.astats.Overall.Number_of_samples", "astats=metadata=1:measure_perchannel=none:measure_overall=Number_of_samples",
    "lavfi.astats.Overall.Number_of_samples=5.000000\n", 1, 5],
  ["lavfi.r128.M", "ebur128=metadata=1", "lavfi.r128.M=-120.691\nlavfi.r128.S=-120.691\nlavfi.r128.I=-70.000\n"
    + "lavfi.r128.LRA=0.000\nlavfi.r128.LRA.low=0.000\nlavfi.r128.LRA.high=0.000\n", 1, 100]
] as const) {
  it(`reorders an existing tag replaced by ${filter}`, async () => {
    assert.equal(await printTags(`ametadata=add:${key}:old,ametadata=add:b:2,ametadata=add:c:3,${filter}`,
      Buffer.alloc(samples * channels * 2), channels), header + "c=3\nb=2\n" + expected);
  });
}
