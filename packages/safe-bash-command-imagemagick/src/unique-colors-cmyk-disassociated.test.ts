import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit CMYK without alpha encoding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colors: ["12345640", "001122ff"], operations: ["-alpha", "disassociate", "-unique-colors"], hex: "ff8000ddffff00ff" },
        { colors: ["56341240", "221100ff"], operations: ["-alpha", "disassociate", "-unique-colors"], hex: "0080ffdd00ffffff" },
        { colors: ["34561240", "112200ff"], operations: ["-alpha", "disassociate", "-unique-colors"], hex: "8000ffddff00ffff" },
        { colors: ["001122ff", "12345640", "001122ff"], operations: ["-alpha", "disassociate", "-unique-colors"], hex: "ff8000ddffff00ff" },
        { colors: ["12345640", "001122ff"], operations: ["-alpha", "disassociate", "-unique-colors", "-unique-colors"], hex: "ff8000ddffff00ff" },
        { colors: ["12345640", "001122ff"], operations: ["-alpha", "disassociate"], hex: "ffff00ffff8000dd" },
        { colors: ["12345640", "001122ff"], operations: ["-unique-colors"], hex: "ca6500a9ff8000dd" },
    ])(`${mode}: orders CMYK inks for $colors after $operations`, async ({ colors, operations, hex }) => {
        const argv = [...colors.map(color => `xc:#${color}`), "+append", "-colorspace", "CMYK", ...operations,
            "-depth", "8", mode === "command" ? "cmyk:-" : "cmyk:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        if ("stdout" in result) expect(result.stdout).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
