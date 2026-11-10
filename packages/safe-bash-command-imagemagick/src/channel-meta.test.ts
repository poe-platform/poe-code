import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: bare Meta is distinct from Meta0.
const inputs = [10, 20, 30, 40, 50, 60].map(value => `xc:gray(${value}%)`);
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ...[["Meta", "00"], ["mEtA", "00"], ["R,Meta", "1a"], ["Meta0", "80"], ["R", "1a"]].map(([channel, expected]) => ({
            name: `separate ${channel}`, expected,
            args: [...inputs, "-combine", "-channel", channel!, "-separate", "+channel", "+append", "-depth", "8", "gray:out"],
        })),
        { name: "negate absent Meta", expected: "274d93af", args: ["xc:#274d93af", "-channel", "Meta", "-negate", "+channel", "-depth", "8", "rgba:out"] },
        { name: "invalid channel preserves destination", expected: "4b454550", args: ["xc:#274d93af", "-channel", "Banana", "-separate", "+channel", "-depth", "8", "gray:out"], invalid: true },
    ])(`${mode}: $name`, async ({ args, expected, ...test }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if ("invalid" in test && test.invalid) {
            expect(result.exitCode).not.toBe(0);
            expect(diagnostic).toContain("unrecognized channel type");
        } else {
            expect(result.exitCode).toBe(0);
            expect(diagnostic).toBe("");
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
