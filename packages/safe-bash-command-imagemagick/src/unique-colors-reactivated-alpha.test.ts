import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including no-extraction and sRGB controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "HSL", unique: true, hex: "60ff5300" },
        { space: "Lab", unique: true, hex: "ff00ff00" },
        { space: "sRGB", unique: true, hex: "48cfff00" },
        { space: "CMYK", unique: true, hex: "fff10000" },
        { space: "HSL", unique: false, hex: "60ff5340" },
        { space: "Lab", unique: false, hex: "ff00ff40" },
    ])(`${mode}: reactivates disassociated $space alpha after unique-colors=$unique`, async ({ space, unique, hex }) => {
        const argv = ["xc:#12345640", "-colorspace", space, "-alpha", "disassociate",
            ...(unique ? ["-unique-colors"] : []), "-alpha", "activate", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
