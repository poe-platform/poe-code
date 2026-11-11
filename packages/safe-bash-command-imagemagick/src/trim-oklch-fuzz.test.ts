import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains the opaque center and original page.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["0%", "2%", "5%", "10%"])(`${mode}: trims near-neutral Oklch at fuzz=%s`, async fuzz => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#444444", "xc:#454542", "xc:#444444", "+append", "-colorspace", "Oklch",
            "-fuzz", fuzz, "-trim", "-format", "%g", "-write", "info:/geometry", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const geometry = mode === "command" || mode === "retained" ? await fs.readFile("/geometry") : files.get("/geometry")!;
        expect(Buffer.from(output).toString("hex")).toBe("454542ff");
        expect(new TextDecoder().decode(geometry)).toBe("3x1+1+0");
        expect(stderr).toBe("");
    });
}
