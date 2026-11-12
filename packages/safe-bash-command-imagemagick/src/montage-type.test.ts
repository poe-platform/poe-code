import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { describe, expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command", "montage"] as const) {
  describe(`montage image types (${mode})`, () => {
    async function run(args: string[]) {
      const ramp = new Uint8Array([...new TextEncoder().encode("P5\n3 1\n255\n"), 100, 110, 120]);
      const original = new Uint8Array([1, 2, 3]);
      const files = new Map([["/ramp.pgm", ramp], ["/existing.rgb", original]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/ramp.pgm", ramp);
      await filesystem.writeFile("/existing.rgb", original);
      if (mode === "command" || mode === "montage") {
        const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const context: CommandContext = {
          command: mode === "command" ? "magick" : "montage", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
          stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
          registerCleanup() {}
        };
        const command = mode === "command" ? createMagickCommand() : createMontageCommand();
        const result = await command.execute(context);
        return { exitCode: result.exitCode, stderr, hex: Buffer.concat(chunks).toString("hex"), existing: await filesystem.readFile("/existing.rgb") };
      }
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      return { exitCode: result.exitCode, stderr: result.stderr, hex: Buffer.from(result.stdoutBytes ?? []).toString("hex"),
        existing: mode === "retained" ? await filesystem.readFile("/existing.rgb") : files.get("/existing.rgb") };
    }

    it.each([
      { type: undefined, expected: "ff000000ff000000ff" },
      { type: "Grayscale", expected: "363636b6b6b6121212" },
      { type: "Bilevel", expected: "000000ffffff000000" },
    ])("renders $type in raw RGB output", async ({ type, expected }) => {
      const result = await run(["-tile", "x1", "-geometry", "1x1+0+0", "xc:red", "xc:lime", "xc:blue",
        ...(type ? ["-type", type] : []), "-depth", "8", "rgb:-"]);
      expect(result).toMatchObject({ exitCode: 0, stderr: "", hex: expected });
    });

    // ImageMagick 7.1.2-35 Q16-HDRI: type changes alpha without changing RGB.
    it.each([
      { type: undefined, expected: "e0802040" },
      { type: "TrueColor", expected: "e08020ff" },
      { type: "TrueColorAlpha", expected: "e0802040" },
    ])("renders $type on a transparent sheet", async ({ type, expected }) => {
      const result = await run(["-background", "none", "xc:#e0802040",
        ...(type ? ["-type", type] : []), "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "rgba:-"]);
      expect(result).toMatchObject({ exitCode: 0, stderr: "", hex: expected });
    });

    it.each(["before", "after"])("normalizes a bilevel ramp with -type %s the input", async position => {
      const option = ["-type", "bIlEvEl"];
      const result = await run(["-tile", "x1", "-geometry", "3x1+0+0",
        ...(position === "before" ? option : []), "/ramp.pgm", ...(position === "after" ? option : []), "-depth", "8", "rgb:-"]);
      expect(result).toMatchObject({ exitCode: 0, stderr: "", hex: "000000000000ffffff" });
    });

    it("rejects a missing type", async () => {
      const result = await run(["xc:red", "-type"]);
      expect(result).toMatchObject({ exitCode: 1, hex: "" });
      expect(result.stderr).toContain("missing argument for -type");
    });

    it("preserves existing output when the type is invalid", async () => {
      const result = await run(["xc:red", "-type", "invalid", "/existing.rgb"]);
      expect(result).toMatchObject({ exitCode: 1, hex: "", existing: new Uint8Array([1, 2, 3]) });
      expect(result.stderr).toContain("image type 'invalid'");
    });
  });
}
