import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI parses only the first option token.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each([
        { operator: " mean ", hex: "800080" },
        { operator: "Mean,Max", hex: "800080" },
        { operator: "Max|Mean", hex: "ff00ff" },
        { operator: "!mean", hex: "000000" },
        { operator: "-Mean", hex: "" },
        { operator: "__Mean", hex: "" },
        { operator: "Mean", hex: "800080" },
        { operator: "m-ean", hex: "800080" },
        { operator: "m_E-aN", hex: "800080" },
        { operator: "Max", hex: "ff00ff" },
        { operator: "bogus", hex: "" },
        { operator: "bogus,Mean", hex: "" },
        { operator: "!bogus", hex: "" },
        { operator: "Mean,bogus", hex: "800080" },
        { operator: " , ,\tMean\nMax", hex: "800080" },
        { operator: " | |Max|bogus", hex: "ff00ff" },
        { operator: "Mean,Max|Min", hex: "" },
        { operator: "! Mean", hex: "" },
        { operator: "!m-ean", hex: "000000" },
        { operator: "", hex: "" },
        { operator: " , ", hex: "" },
    ])(`${mode}: evaluate-sequence operator '$operator'`, async ({ operator, hex }) => {
        const fs = new MemoryFileSystem();
        const args = ["xc:red", "xc:blue", "-evaluate-sequence", operator, "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(hex ? 0 : 1);
        const error = "stderr" in result ? result.stderr : stderr;
        if (hex) expect(error).toBe("");
        else expect(error).toContain("unrecognized evaluate operator");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
