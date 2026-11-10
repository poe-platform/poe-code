import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI output, as big-endian 16-bit samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "1234456789ab7ef4", operations: ["-type", "PaletteAlpha"], format: "rgba", expected: "1234456789ab7ef4" },
        { color: "ebeb0505ffff7ef4", operations: ["-type", "PaletteAlpha", "-channel", "A", "-separate", "+channel"], format: "gray", expected: "7ef4" },
        { color: "1234456789abffff", operations: ["-type", "Palette"], format: "rgba", expected: "1234456789abffff" },
        { color: "1234456789ab7ef4", operations: ["-type", "PaletteAlpha", "-unique-colors"], format: "rgba", expected: "1234456789ab7ef4" },
        { color: "1234456789ab7ef4", operations: ["-type", "TrueColorAlpha"], format: "rgba", expected: "1234456789ab7ef4" },
        { color: "1234456789abffff", operations: ["-type", "PaletteAlpha", "-channel", "A", "-separate", "+channel"], format: "gray", expected: "ffff" },
    ])(`${mode}: preserves canvas #$color with $operations`, async ({ color, operations, format, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = [`xc:#${color}`, ...operations, "-depth", "16", "-endian", "MSB", `${format}:out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
