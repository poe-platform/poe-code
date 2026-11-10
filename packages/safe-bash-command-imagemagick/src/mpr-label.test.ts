import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: [], expected: "one;two;" },
        { operations: ["-write", "mpr:seq", "-delete", "0-1", "mpr:seq"], expected: "two;two;" },
        { operations: ["-write", "mpr:seq", "-delete", "0-1", "-label", "three", "mpr:seq"], expected: "three;three;" },
    ])(`applies the active label to MPR reads (${mode}): $expected`, async ({ operations, expected }) => {
        const filesystem = new MemoryFileSystem();
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]);
        await filesystem.writeFile("/out", original);
        const args = ["-label", "one", "xc:red", "-label", "two", "xc:blue", ...operations, "-format", "%l;", "info:out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), registerCleanup() {},
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
