import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick GIFs: red at 16cs, then blue at 36cs.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const format of ["gif", "webp"] as const) {
  for (const option of ["-delay", "-set"] as const) {
    it.each([
      { value: "17x24.4", milliseconds: format === "gif" ? 700 : 708 },
      { value: "17x24.5", milliseconds: 680 },
      { value: "17x24.6", milliseconds: 680 },
      { value: "12.9x0.5", milliseconds: 13000 },
      { value: "17x25", milliseconds: 680 },
      { value: "17", milliseconds: 170 },
      { value: "13x0", milliseconds: 13000 },
    ])(`rounds tick rates before converting ${format} ${option} $value`, async ({ value, milliseconds }) => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/a.gif", first);
      await fs.writeFile("/b.gif", second);
      const path = `/out.${format}`;
      await fs.writeFile(path, new TextEncoder().encode("KEEP"));
      const args = option === "-delay" ? ["-delay", value, "/a.gif", "/b.gif", path]
        : ["/a.gif", "/b.gif", "-set", "delay", value, path];
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toBe("");
      const output = await fs.readFile(path);
      expect(readImageMetadata(output)).toMatchObject({ pages: 2, delay: [milliseconds, milliseconds] });
      for (const page of [0, 1]) {
        const frame = decodeImage(output, { page, coalesce: false });
        expect(frame).toMatchObject({ width: 4, height: 2 });
        for (let offset = 0; offset < frame.data.length; offset += 4) {
          expect(frame.data[offset + (page === 0 ? 0 : 2)]).toBeGreaterThan(240);
          expect(frame.data[offset + (page === 0 ? 2 : 0)]).toBeLessThan(15);
          expect(frame.data[offset + 1]).toBeLessThan(15);
          expect(frame.data[offset + 3]).toBe(255);
        }
      }
    });
  }
}
