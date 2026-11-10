import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output, including low-contrast and constant controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colors: ["202020", "404040"], unique: false, hex: "000000ffffffffff" },
        { colors: ["a0a0a0", "b0b0b0"], unique: true, hex: "000000ffffffffff" },
        { colors: ["101010", "e0e0e0"], unique: true, hex: "000000ffffffffff" },
        { colors: ["303030", "303030"], unique: true, hex: "000000ff" },
        { colors: ["b0b0b0", "b0b0b0"], unique: true, hex: "ffffffff" },
    ])(`${mode}: Bilevel preserves contrast for $colors (unique=$unique)`, async ({ colors, unique, hex }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = [...colors.map(color => `xc:#${color}`), "+append", "-type", "Bilevel", ...(unique ? ["-unique-colors"] : []), "-depth", "8", "rgba:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(hex);
    });
}
