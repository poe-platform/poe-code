import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "active page on register reads", operations: ["-write", "mpr:seq", "-delete", "0-1", "-page", "9x8+4+3", "mpr:seq"], expected: "9x8+4+3;9x8+4+3;" },
        { name: "unchanged page on register reads", operations: ["-write", "mpr:seq", "-delete", "0-1", "mpr:seq"], expected: "6x5+3+2;6x5+3+2;" },
        { name: "page without register reads", operations: [], expected: "6x5+3+2;6x5+3+2;" },
        { name: "saved geometry after clearing the page setting", operations: ["-write", "mpr:seq", "-delete", "0-1", "-page", "9x8+4+3", "mpr:seq", "-delete", "0-1", "+page", "mpr:seq"], expected: "6x5+3+2;6x5+3+2;" },
    ])(`uses MPR page geometry: $name, ${mode}`, async ({ operations, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("out")!);
        const args = ["-page", "4x3+1+1", "xc:red", "-page", "6x5+3+2", "xc:blue", ...operations, "-format", "%g;", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(bytes)).toBe(expected);
    });
}
