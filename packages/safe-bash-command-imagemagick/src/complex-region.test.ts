import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8, with the output region cleared.
for (const mode of ["sync", "buffered", "retained", "command"]) {
    it.each([
        { name: "real component region", selected: 0, part: 0, region: "1x1+1+0", expected: "203040ff406080ff" },
        { name: "imaginary component region", selected: 1, part: 1, region: "1x1+1+0", expected: "405060ff80a0c0ff" },
        { name: "real region leaves imaginary arithmetic active", selected: 0, part: 1, region: "1x1+1+0", expected: "80a0c0ff80a0c0ff" },
        { name: "imaginary region leaves real arithmetic active", selected: 1, part: 0, region: "1x1+1+0", expected: "406080ff406080ff" },
        { name: "full image region", selected: 0, part: 0, region: "2x1+0+0", expected: "406080ff406080ff" },
        { name: "no region", selected: -1, part: 0, region: "", expected: "406080ff406080ff" },
    ])(`${mode}: complex Add respects $name`, async ({ selected, part, region, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "2x1", "-respect-parentheses",
            ...["xc:#203040", "xc:#405060"].flatMap((input, index) => ["(", input, ...(index === selected ? ["-region", region] : []), ")"]),
            "-complex", "Add", "-delete", String(1 - part), "+region", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
