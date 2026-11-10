import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const rows = [
    "(", "xc:#111111", "xc:#222222", "xc:#333333", "+append", ")",
    "(", "xc:#444444", "xc:#555555", "xc:#666666", "+append", ")", "-append"
];

// Native ImageMagick 7.1.2-35 Q16-HDRI dimensions, including explicit-size controls.
for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "resets the next canvas", input: ["-size", "3x2", "+size", "xc:#111111"], expected: "1x1" },
        { name: "uses an explicit replacement size", input: ["-size", "3x2", "-size", "1x1", "xc:#111111"], expected: "1x1" },
        { name: "preserves an unreset size", input: ["-size", "3x2", "xc:#111111"], expected: "3x2" },
        { name: "resets nested canvases without resizing existing images", input: ["-size", "3x2", "xc:black", "(", "+size", ...rows, ")"], expected: "3x2;3x2;" },
        { name: "uses an explicit size for nested canvases", input: ["-size", "3x2", "xc:black", "(", "-size", "1x1", ...rows, ")"], expected: "3x2;3x2;" },
        { name: "accepts a new size after resetting", input: ["-size", "3x2", "+size", "-size", "2x4", "xc:#111111"], expected: "2x4" },
        { name: "restores the outer size when respecting parentheses", input: ["-respect-parentheses", "-size", "3x2", "(", "+size", "xc:#111111", ")", "xc:black"], expected: "1x1;3x2;" },
        { name: "retains the reset outside ordinary parentheses", input: ["-size", "3x2", "(", "+size", "xc:#111111", ")", "xc:black"], expected: "1x1;1x1;" },
        { name: "resets comparison canvases", input: ["compare", "-size", "3x2", "+size", "xc:#111111", "xc:#111111"], expected: "1x1" },
        { name: "uses an explicit comparison size", input: ["compare", "-size", "3x2", "-size", "1x1", "xc:#111111", "xc:#111111"], expected: "1x1" },
        { name: "preserves an unreset comparison size", input: ["compare", "-size", "3x2", "xc:#111111", "xc:#111111"], expected: "3x2" }
    ])(`$name (${mode})`, async ({ input, expected }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const compare = input[0] === "compare";
        const args = [...input, "-format", expected.includes(";") ? "%wx%h;" : "%wx%h", compare ? "null:" : "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(compare ? expected : "");
        expect("stderr" in result ? result.stderr : stderr).toBe(compare ? "0 (0)" : "");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(compare ? "KEEP" : expected);
    });
}
