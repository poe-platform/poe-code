import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete 8-bit Meta0 gray output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "default filtering", options: ["-thumbnail", "2x1!"], expected: "50b0" },
        { name: "point filtering", options: ["-filter", "point", "-thumbnail", "2x1!"], expected: "40c0" },
        { name: "unchanged dimensions", options: ["-thumbnail", "3x1!"], expected: "4080c0" },
        { name: "no thumbnail", options: [], expected: "4080c0" },
    ])(`${mode}: thumbnail Meta0 $name`, async ({ options, expected }) => {
        const argv = ["-size", "3x1", "xc:white", "-duplicate", "3", "(", "-size", "1x1",
            "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine", ...options,
            "-channel", "Meta0", "-separate", "+channel", "-depth", "8", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
