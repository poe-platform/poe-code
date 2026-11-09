import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  it.each(["NETSCAPE2.0", "NETSCAPEXYZ", "NETSCAPE1.0", "ANIMEXTS1.0", "ANIMEXTSXYZ"])(
    `recognizes the complete GIF looping identifier %s (${mode})`, async identifier => {
      const pixels = Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255);
      const input = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
        .gif({ pageHeight: 1, delay: [70, 130], loop: 4 }).toBuffer();
      const application = Buffer.from(input).indexOf("NETSCAPE2.0");
      expect(application).toBeGreaterThan(-1);
      input.set(new TextEncoder().encode(identifier), application);
      const files = new Map([["/in.gif", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", input);
      const args = ["/in.gif", "/out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
      const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
      if (identifier === "NETSCAPE2.0") {
        expect(extension).toBeGreaterThan(-1);
        expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 3, 0, 0]);
      } else expect(extension).toBe(-1);
      expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 130] });
      expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(pixels);
    }
  );
}
