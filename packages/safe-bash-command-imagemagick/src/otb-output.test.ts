import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const width of [11, 259]) {
  const raster = width === 11 ? Buffer.from("a52058e0f040".repeat(4), "hex")
    : Buffer.from(Array.from({ length: 33 * 12 }, (_, i) => i % 33 < 32 ? ((i % 33) * 13 + Math.floor(i / 33) * 29 + 5) % 256 : 160));
  const input = Buffer.concat([Buffer.from(`P4\n${width} 12\n`), raster]);
  // Full native ImageMagick OTB output: header followed by MSB-first, byte-padded rows.
  const expected = Buffer.concat([Buffer.from(width === 11 ? "000b0c01" : "100103000c01", "hex"), raster]);
  for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const output of ["/out.otb", "OTB:/out.bin"]) {
      it(`writes native OTB bytes (${width}px, ${mode}, ${output})`, async () => {
        const files = new Map<string, Uint8Array>([["/in.pbm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pbm", input);
        const args = ["/in.pbm", "-write", output, "/control.pbm"];
        if (mode === "command") {
          const argumentValues = createCommandArguments(args);
          let stderr = "";
          const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, env: {}, cwd: "/", fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        } else {
          expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const path = output.startsWith("OTB:") ? output.slice(4) : output;
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile(path) : files.get(path)!;
        expect(Buffer.from(bytes)).toEqual(expected);
        const control = mode === "retained" || mode === "command" ? await fs.readFile("/control.pbm") : files.get("/control.pbm")!;
        expect(Buffer.from(control).subarray(-raster.length)).toEqual(raster);
      });
    }
    if (mode !== "command") it(`selects OTB for the final output (${width}px, ${mode})`, async () => {
      const files = new Map<string, Uint8Array>([["/in.pbm", input]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.pbm", input);
      const args = ["/in.pbm", "/out.otb"];
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(Buffer.from(mode === "retained" ? await fs.readFile("/out.otb") : files.get("/out.otb")!)).toEqual(expected);
    });
  }
}
