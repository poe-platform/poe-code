import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const { option, physical: expectedPhysical, info: expectedInfo } of [
    { option: ["-define", "density=254x127"], physical: [[254, 127, 0]], info: "254/127/Undefined;" },
    { option: ["-set", "option:density", "254x127"], physical: [[254, 127, 0]], info: "254/127/Undefined;" },
    { option: ["-units", "PixelsPerInch", "-density", "254x127", "-define", "density=100x50"], physical: [[3937, 1968, 1]], info: "100/50/PixelsPerInch;" },
    { option: ["-density", "254x127"], physical: [[254, 127, 0]], info: "254/127/Undefined;" },
    { option: [], physical: [], info: "72/72/Undefined;" }
  ]) {
    for (const before of [true, false]) {
      for (const remove of [[], ["+define", "density"], ["+set", "option:density"]]) {
        it(`applies density ${option.join(" ")} before=${before} remove=${remove.join(" ")} (${mode})`, async () => {
          const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
          const args = [...(before ? [...option, "xc:red"] : ["xc:red", ...option]), ...remove,
            "-write", "PNG24:/output.png", "-format", "%x/%y/%U;", "info:/output.txt"];
          const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
            args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} } })
            : mode === "sync" ? runConvertCliSync(args, files)
              : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
          expect(result).toMatchObject({ exitCode: 0 });
          const output = mode === "sync" || mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
          const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
          const physical = [];
          for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
            if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs")
              physical.push([png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)]);
          }
          expect(physical).toEqual(expectedPhysical);
          const info = mode === "sync" || mode === "buffered" ? files.get("/output.txt")! : await fs.readFile("/output.txt");
          expect(new TextDecoder().decode(info)).toBe(expectedInfo);
        });
      }
    }
  }
}
