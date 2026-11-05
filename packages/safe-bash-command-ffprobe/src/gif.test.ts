import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

it.each([
  { delays: [10, 90, 10], nominal: "10/1", average: "25/9", duration: "1.100000", bitRate: "916" },
  { delays: [10, 20, 33], nominal: "10/1", average: "100/21", duration: "0.630000", bitRate: "1600" },
  { delays: [12, 18, 24], nominal: "50/3", average: "50/9", duration: "0.540000", bitRate: "1867" },
  { delays: [10, 10, 10], nominal: "10/1", average: "10/1", duration: "0.300000", bitRate: "3360" }
])("reports native GIF timing and pixel format for delays $delays", async ({ delays, nominal, average, duration, bitRate }) => {
  const bytes = Buffer.from("R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAFoAAAAsAAAAAAQABACAAIAAAAAAAgSEjwkFACH5BAAKAAAALAAAAAAEAAQAgAAA/wAAAAIEhI8JBQA7", "base64");
  let frame = 0;
  for (let offset = 0; offset < bytes.length - 4; offset++) {
    if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9 && bytes[offset + 2] === 4) {
      bytes.writeUInt16LE(delays[frame++]!, offset + 4);
    }
  }
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.gif", bytes);
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe",
    ...createCommandArguments(["-v", "error", "-show_streams", "-show_format", "-show_frames", "-show_entries", "stream=codec_name,pix_fmt,avg_frame_rate,r_frame_rate,duration,nb_frames:format=duration,size,bit_rate:frame=pix_fmt", "-of", "json", "/input.gif"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output)).toMatchObject({
    streams: [{ codec_name: "gif", pix_fmt: "bgra", r_frame_rate: nominal, avg_frame_rate: average, duration, nb_frames: "3" }],
    format: { duration, size: "126", bit_rate: bitRate },
    frames: [{ pix_fmt: "bgra" }, { pix_fmt: "bgra" }, { pix_fmt: "bgra" }]
  });
});
