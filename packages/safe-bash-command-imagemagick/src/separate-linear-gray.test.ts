import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete stdout from ImageMagick 7.1.2-35 Q16-HDRI, including sRGB controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: "#808080", space: "LinearGray", channel: "R", output: "info", after: [], expected: "Gray|gray  1.0" },
        { input: "#808080", space: "LinearGray", channel: "R", output: "rgba", after: ["-colorspace", "sRGB"], expected: "374237423742ffff" },
        { input: "#80808040", space: "RGB", channel: "A", output: "info", after: [], expected: "Gray|gray  1.0" },
        { input: "#80808040", space: "RGB", channel: "A", output: "rgba", after: ["-colorspace", "sRGB"], expected: "404040404040ffff" },
        { input: "#808080", space: "LinearGray", channel: "R", output: "gray", after: [], expected: "3742" },
        { input: "#808080", space: "sRGB", channel: "R", output: "rgba", after: ["-colorspace", "sRGB"], expected: "808080808080ffff" },
        { input: "#80808040", space: "sRGB", channel: "A", output: "rgba", after: ["-colorspace", "sRGB"], expected: "404040404040ffff" },
        { input: "#80808040", space: "RGB", channel: "A", output: "info", after: [], format: "%[colorspace]|%[gamma]", expected: "Gray|1" },
        { input: "#80808040", space: "RGB", channel: "A", output: "info", after: ["-colorspace", "sRGB"], format: "%[colorspace]|%[gamma]", expected: "sRGB|0.454545" },
        { input: "#80808040", space: "RGB", channel: "A", output: "rgba", after: ["-poly", "1,1"], expected: "404040404040ffff" },
        { input: "#80808040", space: "RGB", channel: "A", output: "rgba", after: ["-evaluate-sequence", "Mean"], expected: "404040404040ffff" }
    ])(`${mode}: separates $space $channel into $output, after=$after`, async ({ input, space, channel, output, after, expected, format = "%[colorspace]|%[channels]" }) => {
        const argv = [`xc:${input}`, "-colorspace", space, "-channel", channel, "-separate", "+channel",
            ...after,
            ...(output === "info" ? ["-format", format] : ["-depth", "16", "-endian", "MSB"]),
            `${output}:${mode === "command" ? "-" : "out"}`];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("out")!);
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
