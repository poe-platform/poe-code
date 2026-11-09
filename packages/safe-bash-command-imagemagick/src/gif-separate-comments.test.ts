import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Unmodified single-frame GIFs; expected frames recorded with ImageMagick 7.1.2-35 Q16-HDRI.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");
const red = { comment: "First", delay: 160, disposal: 2, pixel: [255, 0, 0, 255] };
const purple = { comment: "First", delay: 160, disposal: 2, pixel: [128, 0, 128, 255] };
const blue = { comment: "Second", delay: 360, disposal: 3, pixel: [0, 0, 255, 255] };

for (const mode of ["sync", "buffered", "filesystem", "command"] as const) {
  it.each([
    { name: "assembly", options: [], expected: [red, blue] },
    { name: "morph", options: ["-morph", "1"], expected: [red, purple, blue] },
    { name: "morphed middle frame", options: ["-morph", "1", "-delete", "0,2"], expected: [purple] }
  ])(`preserves separate GIF comments during $name (${mode})`, async ({ options, expected }) => {
    const files = new Map<string, Uint8Array>([["/first.gif", first], ["/second.gif", second]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argumentValues = createCommandArguments(["/first.gif", "/second.gif", ...options, "/out.gif"]);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
      : await runConvertCli(argumentValues.args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    const output = mode === "filesystem" || mode === "command" ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
    expect((decodeImage(output, { animated: true }).pages ?? 1)).toBe(expected.length);
    for (const [page, frame] of expected.entries()) {
      const decoded = decodeImage(output, { page, coalesce: false });
      expect(decoded).toMatchObject({
        width: 4, height: 2, properties: { comment: frame.comment }, disposal: frame.disposal
      });
      expect(decoded.delay?.[page]).toBe(frame.delay);
      expect([...decoded.data]).toEqual(Array.from({ length: 8 }, () => frame.pixel).flat());
    }
  });
}
