import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: parsed backgrounds have no reference fuzz;
// inferred corner colors inherit the image fuzz.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "#333333", fuzz: "20%", explicit: true, empty: false },
        { background: "#005544", fuzz: "30%", explicit: true, empty: false },
        { background: "red", fuzz: "30%", explicit: true, empty: false },
        { background: "#333333", fuzz: "20%", explicit: false, empty: true },
        { background: "#333333", fuzz: "5%", explicit: true, empty: false },
        { background: "#333333", fuzz: "40%", explicit: true, empty: true },
    ])(`${mode}: percentage trim background=$background fuzz=$fuzz explicit=$explicit`, async ({ background, fuzz, explicit, empty }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = [`xc:${background}`, "xc:#803060", `xc:${background}`, "+append", "-fuzz", fuzz,
            "-define", "trim:percent-background=50",
            ...(explicit ? ["-define", `trim:background-color=${background}`] : []),
            "-trim", "-format", "%wx%h|%g", "info:/out"];
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
        expect(new TextDecoder().decode(output)).toBe(empty ? "1x1|3x1-1-1" : "1x1|3x1+1+0");
        expect({ stdout, stderr, ...result }).toEqual({
            exitCode: 0, stdout: "", stderr: empty ? "magick: geometry does not contain image\n" : "",
        });
    });
}
