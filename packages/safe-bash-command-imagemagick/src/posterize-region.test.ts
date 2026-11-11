import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, +dither -posterize 3 -depth 8 rgba:-.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { alpha: "80", region: "1x1+0+0", expected: "8080ff8046370f80" },
        { alpha: "40", region: "1x1+0+0", expected: "8080ff801a170440" },
        { alpha: "c0", region: "1x1+0+0", expected: "8080ffff886720c0" },
        { alpha: "00", region: "1x1+0+0", expected: "0000000000000000" },
        { alpha: "ff", region: "1x1+0+0", expected: "8080ffffa07030ff" },
        { alpha: "80", region: "1x1+1+0", expected: "412d648080800080" },
        { alpha: "80", region: "1x1+0+0", depth: "16", expected: "80008000ffff8000469737690f2d8080" },
        { alpha: "80", region: "1x1+0+0", after: ["-negate"], expected: "80800080514d4380" },
        { alpha: "80", region: "", expected: "8080ff8080800080" },
        { alpha: "80", region: "2x1+0+0", expected: "8080ff8080800080" },
        { alpha: "", region: "1x1+0+0", expected: "8080ffffa07030ff" },
    ])(`${mode}: posterizes alpha=$alpha region=$region (case %#)`, async ({ alpha, region, depth = "8", after = [], expected }) => {
        const argv = ["-seed", "42", `xc:#9050c0${alpha}`, `xc:#a07030${alpha}`, "+append",
            ...(region ? ["-region", region] : []), "+dither", "-posterize", "3",
            ...after, ...(region ? ["+region"] : []), "-depth", depth, "-endian", "MSB", "rgba:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
