import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const definition = `push defs
push clip-path "limit"
push graphic-context
rectangle 1,1 3,2
pop graphic-context
pop clip-path
pop defs`;
const clipped = (compliance: string) => `push graphic-context
${compliance}
${definition}
push graphic-context
clip-path "url(#limit)"
rectangle 0,0 5,3
pop graphic-context
pop graphic-context`;
// Complete 6x4 RGB rasters verified against ImageMagick 7.1.2-35 Q16-HDRI.
const black = "000000".repeat(24), green = "008000".repeat(24);
const limited = "ffffff".repeat(6) + ("ffffff" + "000000".repeat(3) + "ffffff".repeat(2)).repeat(2) + "ffffff".repeat(6);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["SVG green fill", 'compliance "SVG"\nfill green rectangle 0,0 5,3', green],
        ["green fill control", "fill green rectangle 0,0 5,3", green],
        ["SVG clip", clipped('compliance "SVG"'), black],
        ["default clip control", clipped(""), limited],
        ["explicit MVG clip", clipped('compliance "MVG"'), limited],
        ["case insensitive SVG", clipped('compliance "svg"'), black],
        ["restored default compliance", clipped('push graphic-context compliance "SVG" pop graphic-context'), limited],
        ["restored SVG compliance", clipped('compliance "SVG" push graphic-context compliance "MVG" pop graphic-context'), black],
        ["switch from SVG to MVG", clipped('compliance "SVG" compliance "MVG"'), limited],
        ["unknown compliance uses MVG behavior", clipped('compliance "unknown"'), limited],
        ["switch to SVG after selecting a clip", clipped("").replace("rectangle 0,0 5,3", "compliance SVG rectangle 0,0 5,3"), black],
        ["switch to MVG after selecting a clip", clipped("compliance SVG").replace("rectangle 0,0 5,3", "compliance MVG rectangle 0,0 5,3"), limited],
        ["restore an active clip after SVG context", clipped("").replace("rectangle 0,0 5,3", "push graphic-context compliance SVG pop graphic-context rectangle 0,0 5,3"), limited],
        ["SVG preserves named masks", clipped("compliance SVG").replaceAll("clip-path", "mask").replace("rectangle 1,1 3,2", "fill white rectangle 1,1 3,2"),
            "000000".repeat(6) + ("000000" + "ffffff".repeat(3) + "000000".repeat(2)).repeat(2) + "000000".repeat(6)],
        ["explicit MVG input", clipped('compliance "SVG"'), black],
    ])(`${mode}: %s`, async (name, drawing, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const input = new TextEncoder().encode(drawing);
        files.set("drawing.mvg", input);
        await fs.writeFile("/drawing.mvg", input);
        const argv = ["-size", "6x4", "-stroke", "none", "-fill", "black",
            ...(name === "explicit MVG input" ? ["-background", "white", "mvg:drawing.mvg"] : ["xc:white", "-draw", drawing]),
            "-depth", "8", "rgb:-"];
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
