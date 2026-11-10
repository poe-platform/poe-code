import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including alpha after explicit sRGB conversion.
const cases = [
    { space: "HSL", filter: true, expected: "1f364e5f627fa1b398aac8e1" },
    { space: "Lab", filter: true, expected: "2534455f6e7e91b39aaac6e1" },
    { space: "sRGB", filter: true, expected: "2636465f708093b39aaac6e1" },
    { space: "HSL", filter: false, expected: "102030128090a093a0b0d0b5" },
    { space: "Lab", filter: false, expected: "102030128090a093a0b0d0b5" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`${mode}: preserves $space mean-shift results after conversion (filter=$filter)`, async ({ space, filter, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = ["xc:#10203012", "xc:#8090a093", "xc:#a0b0d0b5", "+append", "-colorspace", space,
            ...(filter ? ["-mean-shift", "3x3+150%"] : []), "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
