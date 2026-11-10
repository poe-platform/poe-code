import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI separates mask channel names into eight zero bytes.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const withMask of [false, true]) {
    it.each(["read-mask", "write-mask", "ReadMask", "WriteMask", "bogus"])(
      `${mode}: separates %s with mask=${withMask} without accepting unknown names`, async channel => {
        const keep = new TextEncoder().encode("KEEP");
        const mask = new Uint8Array([...new TextEncoder().encode("P5\n4 2\n255\n"), 0, 255, 0, 255, 255, 0, 255, 0]);
        const files = new Map([["/out", keep], ["/mask.pgm", mask]]);
        const fs = createMemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["-size", "4x2", "xc:#80402060", ...(withMask ? ["-write-mask", "/mask.pgm"] : []),
          "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const diagnostic = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        if (channel === "bogus") {
          expect(result.exitCode).toBe(1);
          expect(diagnostic).toContain("unrecognized channel type 'bogus'");
          expect(output).toEqual(keep);
        } else {
          expect(result.exitCode).toBe(0);
          expect(diagnostic).toBe("");
          expect(output).toEqual(new Uint8Array(8));
        }
      });
  }
}
