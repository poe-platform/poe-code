import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        [["xc:red", "-write", "saved.ppm", "-exit", "xc:blue", "later.ppm"], ["saved.ppm"], ""],
        [["xc:red", "-write", "saved.ppm", "-exit"], ["saved.ppm"], ""],
        [["xc:red", "-exit"], [], ""],
        [["-exit"], [], ""],
        [["xc:red", "-depth", "8", "-write", "rgb:-", "-exit", "xc:blue", "rgb:-"], [], "ff0000"],
        [["xc:red", "-write", "saved.ppm", "null:"], ["saved.ppm"], ""],
        [["xc:red", "-exit", "-not-an-option", "later.ppm"], [], ""],
        [["(", "xc:red", "-write", "saved.ppm", "-exit", ")", "later.ppm"], ["saved.ppm"], ""],
        [["xc:red", "-set", "comment", "-exit", "-depth", "8", "rgb:-"], [], "ff0000"],
        [["xc:red", "--", "-exit"], ["-exit"], ""],
    ] as const)(`stops only at an exit option (${mode}): %j`, async (args, names, hex) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const stdout = result.stdoutBytes ?? new TextEncoder().encode(result.stdout);
        expect(Buffer.from(stdout).toString("hex")).toBe(hex);
        const actualNames = mode === "command" || mode === "retained"
            ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
        expect(actualNames).toEqual(names);
        if (names.some(name => name === "saved.ppm")) {
            const saved = mode === "command" || mode === "retained" ? await filesystem.readFile("/saved.ppm") : files.get("saved.ppm")!;
            expect(Buffer.from(saved).subarray(-6).toString("hex")).toBe("ffff00000000");
        }
    });
}
