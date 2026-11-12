import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian 16-bit RGB rasters.
const cases = [
 ["HSL", "000000000000000100010001", "17173e3e5959b5b568682929"],
 ["RGB", "000000000000000d000d000d", "17173e3e5959b5b568682929"],
 ["Lab", "0000ab4bf3100000ab4bf30f", "17193e3e5958b5b768642925"],
 ["CMYK", "fffffffffffffffefffefffe", "17173e3e5959b5b568682929"],
 ["sRGB", "000000000000000100010001", "17173e3e5959b5b568682929"],
] as const;

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 for (const [space, labels, means] of cases) {
  for (const meanColor of [false, true]) it(`converts ${space} component ${meanColor ? "means" : "labels"} back to sRGB (${mode})`, async () => {
   const args = ["xc:#173e59", "xc:#b56829", "+append", "-colorspace", space,
    ...(meanColor ? ["-define", "connected-components:mean-color=true"] : []),
    "-connected-components", "4", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgb:out.raw"];
   const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
   let stderr = "";
   const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
   }) : mode === "sync" ? runConvertCliSync(args, files)
    : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   expect(result.exitCode).toBe(0);
   expect("stderr" in result ? result.stderr : stderr).toBe("");
   const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
   expect(Buffer.from(bytes).toString("hex")).toBe(meanColor ? means : labels);
  });
 }
}
