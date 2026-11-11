import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const alpha of [false, true]) {
    for (const { name, options, linear } of [
      { name: "sRGB", options: [], linear: false },
      { name: "RGB", options: ["-colorspace", "RGB"], linear: true },
      { name: "scRGB", options: ["-colorspace", "scRGB"], linear: true },
      { name: "converted back to sRGB", options: ["-colorspace", "RGB", "-colorspace", "sRGB"], linear: false },
    ]) {
      it(`writes the native QOI colorspace and samples: ${name}, alpha=${alpha}, ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "1x1", alpha ? "xc:#80402080" : "xc:#804020", ...options, mode === "command" ? "qoi:-" : "/out.qoi"];
        let bytes: Uint8Array;
        if (mode === "command") {
          const arguments_ = createCommandArguments(args), chunks: Uint8Array[] = [];
          let stderr = "";
          const result = await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
          });
          expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
          bytes = Buffer.concat(chunks);
        } else {
          const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
          expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
          bytes = mode === "retained" ? await fs.readFile("/out.qoi") : files.get("/out.qoi")!;
        }
        // Native ImageMagick Q16-HDRI output, compared without using the QOI reader.
        const expected = `716f69660000000100000001${alpha ? "04" : "03"}${linear ? "01" : "00"}${alpha ? "ff" : "fe"}${linear ? "370d04" : "804020"}${alpha ? "80" : ""}0000000000000001`;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
      });
    }
  }
}
