import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: opaque canvas expansion does not activate alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Off", operation: ["-border", "1"], expected: "000000000000000000" },
        { alpha: "Off", operation: ["-extent", "2x1"], expected: "0000" },
        { alpha: "Deactivate", operation: ["-extent", "2x1"], expected: "0000" },
        { alpha: "Off", operation: [], expected: "00" },
        { alpha: "On", operation: ["-extent", "2x1"], expected: "ffff" },
        { alpha: "On", operation: ["-border", "1"], expected: "ffffffffffffffffff" }
    ])(`${mode}: separates alpha after $alpha and $operation`, async ({ alpha, operation, expected }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = ["xc:#80402060", "-alpha", alpha, ...operation,
            "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
