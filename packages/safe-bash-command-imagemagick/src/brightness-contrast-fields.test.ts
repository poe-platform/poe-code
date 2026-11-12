import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 16-bit MSB RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["15,25,50", 0, "3b66abd6ffffb3de"],
        ["15x25x50", 0, "3b66abd6ffffb3de"],
        ["15,,25", 0, "4c8ca0e0ffffa6e6"],
        ["15xx25", 0, "4c8ca0e0ffffa6e6"],
        ["15x25", 0, "3b66abd6ffffb3de"],
        ["15", 0, "4c8ca0e0ffffa6e6"],
        ["x25", 1, "4b454550"],
        ["15xy", 1, "4b454550"],
        ["15x25xy", 1, "4b454550"],
    ] as const)(`${mode}: validates brightness-contrast %s before replacing output`, async (geometry, exitCode, expected) => {
        const destination = new TextEncoder().encode("KEEP");
        const files = new Map([["out", destination]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", destination);
        const argv = ["xc:#267ada80", "-brightness-contrast", geometry, "-endian", "MSB", "-depth", "16", "rgba:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(result.exitCode).toBe(exitCode);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
        if (exitCode) expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-brightness-contrast'");
    });
}
