import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI clamps Over compositing, but retains Copy samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "translucent above-range source", color: "#203050c0", amount: "100%", border: true, compose: "Over", expected: "00000000" },
        { name: "opaque above-range source", color: "#203050", amount: "100%", border: true, compose: "Over", expected: "00000000" },
        { name: "in-range source", color: "#203050c0", amount: "0", border: true, compose: "Over", expected: "2e3549e0" },
        { name: "Copy preserves above-range samples", color: "#203050c0", amount: "100%", border: true, compose: "Copy", expected: "203050c0" },
        { name: "evaluate preserves above-range samples", color: "#203050c0", amount: "100%", border: false, compose: "Over", expected: "203050c0" },
    ])(`${mode}: $name`, async ({ color, amount, border, compose, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [`xc:${color}`, "-evaluate", "add", amount,
            ...(border ? ["-compose", compose, "-bordercolor", "#80502080", "-border", "1"] : []),
            "-evaluate", "subtract", amount, ...(border ? ["-crop", "1x1+1+1", "+repage"] : []), "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
