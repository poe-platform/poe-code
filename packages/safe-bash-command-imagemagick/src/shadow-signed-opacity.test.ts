import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI references.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { opacity: "-50", alpha: "-0.25098", multiply: "-1", pixel: "d0502840" },
        { opacity: "0", alpha: "0", multiply: "1", pixel: "d0502800" },
        { opacity: "50", alpha: "0.25098", multiply: "1", pixel: "d0502840" },
        { opacity: "+50", alpha: "0.25098", multiply: "1", pixel: "d0502840" },
    ])(`preserves signed shadow opacity $opacity (${mode})`, async ({ opacity, alpha, multiply, pixel }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:#507ba080", "-background", "#d05028", "-shadow", `${opacity}x0+0+0`,
            "-format", "%wx%h %g %[fx:p{0,0}.a]", "-write", "info:",
            "-channel", "A", "-evaluate", "multiply", multiply, "+channel", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(`3x2 3x2+0+0 ${alpha}`);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixel.repeat(6));
    });
}
