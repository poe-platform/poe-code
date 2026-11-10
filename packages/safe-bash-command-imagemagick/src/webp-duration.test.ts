import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick GIFs: red at 16 cs, then blue at 36 cs.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const quality of [75, 100]) {
    for (const write of [false, true]) {
      it.each(["1677722", "-1", "-2", "1", "0", "1677721", undefined])(
        `handles WebP delay %s (${mode}, quality=${quality}, write=${write})`, async delay => {
          const keep = new TextEncoder().encode("KEEP");
          const files = new Map<string, Uint8Array>([["/a.gif", first], ["/b.gif", second], ["/out.webp", keep]]);
          const fs = new MemoryFileSystem();
          for (const [path, bytes] of files) await fs.writeFile(path, bytes);
          const args = ["/a.gif", "/b.gif", "-quality", String(quality),
            ...(delay === undefined ? [] : ["-set", "delay", delay]),
            ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])];
          let stderr = "";
          const argumentValues = createCommandArguments(args);
          const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
          const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.webp") : files.get("/out.webp")!;
          const diagnostic = "stderr" in result ? result.stderr : stderr;
          if (delay === "1677722" || delay === "-1" || delay === "-2") {
            expect(result.exitCode).toBe(1);
            expect(diagnostic).toContain("Invalid WebP frame duration");
            expect(output).toEqual(keep);
          } else {
            expect(result.exitCode).toBe(0);
            expect(diagnostic).toBe("");
            expect(readImageMetadata(output)).toMatchObject({
              pages: 2, delay: delay === undefined ? [160, 360] : [Number(delay) * 10, Number(delay) * 10],
            });
            for (const page of [0, 1]) {
              const pixels = decodeImage(output, { page }).data;
              for (let offset = 0; offset < pixels.length; offset += 4) {
                expect(pixels[offset + (page === 0 ? 0 : 2)]).toBeGreaterThan(240);
                expect(pixels[offset + (page === 0 ? 2 : 0)]).toBeLessThan(15);
                expect(pixels[offset + 1]).toBeLessThan(15);
                expect(pixels[offset + 3]).toBe(255);
              }
            }
          }
          expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.gif", "b.gif", "out.webp"]);
        }
      );
    }
  }
}
