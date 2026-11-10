import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-compose", "Copy", "+compose"], hex: "ba4125f6" },
        { options: ["-compose", "Copy"], hex: "c04020ed" },
        { options: ["-compose", "Over"], hex: "ba4125f6" },
        { options: [], hex: "ba4125f6" },
        { options: ["+compose"], hex: "ba4125f6" },
        { options: ["-compose", "Copy", "+compose", "-compose", "Copy"], hex: "c04020ed" }
    ])(`${mode}: $options matches native composition`, async ({ options, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = ["xc:#2060b080", "xc:#c04020ed", ...options, "-composite", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
