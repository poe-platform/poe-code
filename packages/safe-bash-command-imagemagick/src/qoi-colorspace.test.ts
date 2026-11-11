import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: linear 128/64/32 becomes sRGB 188/137/99.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const flag of [0, 1]) for (const convert of [false, true]) {
    it(`honors QOI colorspace ${flag}, convert=${convert}, ${mode}`, async () => {
      const input = Buffer.from("716f696600000001000000010301fe8040200000000000000001", "hex");
      input[13] = flag;
      const files = new Map<string, Uint8Array>([["/in.qoi", input]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.qoi", input);
      const args = ["/in.qoi", "-format", "%[colorspace]", "-write", "info:",
        ...(convert ? ["-colorspace", "sRGB"] : []), "-depth", "8", "rgba:/out.rgba"];
      const expectedSpace = flag === 1 ? "RGB" : "sRGB";
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expectedSpace, stderr: "" });
      } else {
        const result = mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: expectedSpace, stderr: "" });
      }
      const output = mode === "sync" || mode === "buffered" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
      expect(Buffer.from(output).toString("hex")).toBe(flag === 1 && convert ? "bc8963ff" : "804020ff");
    });
  }
}
