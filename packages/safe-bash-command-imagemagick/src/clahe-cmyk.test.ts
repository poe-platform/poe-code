import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, all C/M/Y/K/alpha samples from the reported strips.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        [["xc:#333333", "xc:#777777", "xc:#aaaaaa"], false, "000000ccff00000088ff00000055ff"],
        [["xc:#333333", "xc:#777777", "xc:#aaaaaa"], true, "00000088ff00000046ff00000024ff"],
        [["xc:red", "xc:lime", "xc:blue"], false, "00ffff00ffff00ff00ffffff0000ff"],
        [["xc:red", "xc:lime", "xc:blue"], true, "00ffe70affff00c41dffcbe70000ff"],
        [["xc:#33333340", "xc:#77777780", "xc:#aaaaaac0"], true, "0000008840000000468000000024c0"],
        [["xc:#ff000040", "xc:#00ff0080", "xc:#0000ffc0"], true, "00ffe70a40ff00c41d80cbe70000c0"],
    ] as const)(`updates CLAHE ink samples via ${mode}: %j, filtered=%s`, async (inputs, filtered, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = [...inputs, "+append", "-colorspace", "CMYK",
            ...(filtered ? ["-clahe", "2x2+16+2"] : []), "-depth", "8", "cmyka:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "public" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
