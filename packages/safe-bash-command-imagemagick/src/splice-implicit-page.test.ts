import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7 Q16-HDRI, 6x4 RGB with red samples 1 through 24.
const cases = [
    ["10x8+0+0", "+1+1", "16x12|27x24+0+0"],
    ["3x2+0+0", "+1+1", "9x6|5x3+0+0"],
    ["3x2+0+0", "2", "8x6|4x3+0+0"],
    ["3x2+0+0", "2x1/3", "9x6|5x3+0+0"],
    ["3x2+0+0", "3x2+1+1", "9x6|5x3+0+0"],
    ["", "+1+1", "12x8|12x8+0+0"],
    ["0x2+0+0", "+1+1", "12x6|0x3+0+0"],
    ["10x8+0+0", "1.2.3x2", "16x12|27x24+0+0"],
    ["10x8+0+0", "50%", "9x6|15x12+0+0"],
    ["10x8+0+0", "2:1", "12x7|20x14+0+0"],
    ["10x8+0+0", "2x1<", "12x8|20x16+0+0"],
    ["10x8+0+0", "50%+1+1", "12x8|20x16+0+0"],
    ["10x8+0+0", "2x", "8x4|13x8+0+0"],
    ["10x8+0+0", "2x+1+1", "8x12|13x24+0+0"],
    ["10x8+0+0", "x2", "6x6|10x12+0+0"],
] as const;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`sizes implicit splice bands from page %s, geometry %s (${mode})`, async (page, geometry, expected) => {
        const input = Uint8Array.from(Array.from({ length: 24 }, (_, i) => [i + 1, 50, 123]).flat());
        const files = new Map([["/in.rgb", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.rgb", input);
        const argv = ["-size", "6x4", "-depth", "8", "rgb:/in.rgb",
            ...(page ? ["-repage", page] : []), "-gravity", "NorthWest", "-splice", geometry,
            "-depth", "8", "-write", "rgb:/out", "-format", "%wx%h|%g", "info:"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
        if (page === "10x8+0+0" && geometry === "+1+1") {
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(output.length).toBe(576);
            expect(createHash("sha256").update(output).digest("hex"))
                .toBe("f8d02f50240abd016e7f575ee77ab1772a6b2cdba3ec3aa7d5a37f3402aec0b0");
        }
    });
}
