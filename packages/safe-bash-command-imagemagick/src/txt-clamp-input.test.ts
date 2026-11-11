import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI clamps 300 to 255 and preserves green/blue.
for (const mode of ["buffered", "sync", "command"] as const) {
  for (const red of [255, 300]) {
    it.each(["raw", "fx"])(`clamps TXT channels (${mode}, red=${red}, %s)`, async output => {
      const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,255,srgb\n0,0: (${red},2,3)\n`);
      const files = new Map([["/in.txt", bytes]]);
      const args = output === "raw" ? ["/in.txt", "-depth", "8", "rgb:/out.rgb"]
        : ["/in.txt", "-format", "%[fx:p.r],%[fx:p.g],%[fx:p.b]", "info:"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.txt", bytes);
      let result;
      if (mode === "sync") result = runConvertCliSync(args, files);
      else if (mode === "buffered") result = await runConvertCli(args, files);
      else {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      }
      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: output === "fx" ? "1,0.00784314,0.0117647" : "" });
      if (output === "raw") {
        const raw = mode === "command" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect(Buffer.from(raw).toString("hex")).toBe("ff0203");
      }
    });
  }
}
