import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI retains the blue rectangle in all cases.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { fuzz: "0", explicit: true },
        { fuzz: "1%", explicit: true },
        { fuzz: "0", explicit: false },
    ])(`${mode}: HWB percentage trim fuzz=$fuzz explicit=$explicit`, async ({ fuzz, explicit }) => {
        for (const bounds of [false, true]) {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const argv = ["-size", "5x5", "xc:red", "-fill", "blue", "-draw", "rectangle 2,2 3,3",
                "-colorspace", "HWB", "-fuzz", fuzz, "-define", "trim:percent-background=90",
                ...(explicit ? ["-define", "trim:background-color=red"] : []),
                ...(bounds ? [] : ["-trim"]), "-format", bounds ? "%@" : "%wx%h %g", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(bounds ? "2x2+2+2" : "2x2 5x5+2+2");
            expect({ stdout, stderr, ...result }).toEqual({
                exitCode: 0, stdout: "", stderr: "",
            });
        }
    });
}
