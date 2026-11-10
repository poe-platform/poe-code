import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI raw RGBA bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of ["60", "ff"]) {
        it.each(["region", "mask", "none"])(`${mode}: extracts ${alpha} alpha with %s selection`, async selection => {
            const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 0, 255, 255, 0, 255, 0])]);
            const argv = ["-size", "4x2", `xc:#804020${alpha}`,
                ...(selection === "region" ? ["-region", "1x1+0+0"] : selection === "mask" ? ["-write-mask", "mask.pgm"] : []),
                "-alpha", "extract", "-depth", "8", "rgba:out"];
            const files = new Map([["out", Buffer.from("KEEP")], ["mask.pgm", mask]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", Buffer.from("KEEP"));
            await fs.writeFile("/mask.pgm", mask);
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const edited = alpha.repeat(3) + (selection === "none" ? "ff" : "00");
            const protectedPixel = alpha === "ff" ? "804020ff" : "472f23ff";
            const selected = selection === "region" ? [true, false, false, false, false, false, false, false]
                : selection === "mask" ? [true, false, true, false, false, true, false, true] : Array(8).fill(true);
            expect(Buffer.from(output).toString("hex")).toBe(selected.map(value => value ? edited : protectedPixel).join(""));
        });
    }
}
