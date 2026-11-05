import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

it("reports native GIF decoded pixel format for the stream and every frame", async () => {
  const bytes = Buffer.from("R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAFoAAAAsAAAAAAQABACAAIAAAAAAAgSEjwkFACH5BAAKAAAALAAAAAAEAAQAgAAA/wAAAAIEhI8JBQA7", "base64");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.gif", bytes);
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe",
    ...createCommandArguments(["-v", "error", "-show_streams", "-show_frames", "-show_entries", "stream=codec_name,pix_fmt:frame=pix_fmt", "-of", "json", "/input.gif"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output)).toMatchObject({
    streams: [{ codec_name: "gif", pix_fmt: "bgra" }],
    frames: [{ pix_fmt: "bgra" }, { pix_fmt: "bgra" }, { pix_fmt: "bgra" }]
  });
});
