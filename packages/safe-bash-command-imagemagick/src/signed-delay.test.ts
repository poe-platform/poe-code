import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

// ImageMagick 7.1.2-35 Linux Q16-HDRI: unsigned size_t arithmetic in gif.c.
for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  for (const property of [false, true]) {
    it.each([[-1, 36699], [-2, 36698], [-5, 36695], [0, 0], [17, 17]])(
      `encodes signed delay %i (${mode}, set=${property})`, async (count, centiseconds) => {
        const files = new Map<string, Uint8Array>([["/a.gif", first], ["/b.gif", second], ["/out.gif", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const input = property ? ["/a.gif", "/b.gif", "-set", "delay", String(count)] : ["-delay", String(count), "/a.gif", "/b.gif"];
        for (const destination of [["/out.gif"], ["-format", "%T|", "info:"]]) {
          const args = [...input, ...destination];
          let stdout = "";
          const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async value => { stdout += typeof value === "string" ? value : new TextDecoder().decode(value); } }, stderr: { write: async () => {} },
          }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
          expect(result.exitCode).toBe(0);
          if (destination.at(-1) === "info:") {
            const expected = count < 0 ? "1.8446744073709552e+19" : String(count);
            expect("stdout" in result ? result.stdout : stdout).toBe(`${expected}|${expected}|`);
          }
        }
        const output = mode === "map" || mode === "sync" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
        expect(decodeImage(output, { animated: true }).delay).toEqual([centiseconds * 10, centiseconds * 10]);
        for (const [page, bytes] of [first, second].entries()) {
          const original = decodeImage(bytes, { coalesce: false });
          expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
            width: original.width, height: original.height, data: original.data,
            disposal: original.disposal, properties: original.properties,
          });
        }
      }
    );
  }
}
