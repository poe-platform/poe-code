import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including alpha.
    it.each([
        { space: "Gray", channel: "R", geometry: "3x1", expected: "ffffff40000000a0ffffffee" },
        { space: "Gray", channel: "R", geometry: "1x1", expected: "00000040000000a0000000ee" },
        { space: "Gray", channel: "", geometry: "3x1", expected: "ffffff00000000ffffffffff" },
        { space: "sRGB", channel: "R", geometry: "3x1", expected: "00709040ff4020a0ff70a0ee" },
    ])(`${mode}: local threshold $geometry in $space with channel '$channel'`, async ({ space, channel, geometry, expected }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append", "-colorspace", space,
            ...(channel ? ["-channel", channel] : []), "-lat", geometry, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
