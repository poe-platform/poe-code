import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pair = ["xc:red", "xc:#008000", "+append"];
const strip = ["xc:red", "xc:lime", "xc:blue", "+append"];
const average = "ff000000ff000000ff", luma = "0000ffff000000ff00";
// ImageMagick 7.1.2-35 Q16-HDRI: Average distinguishes this red/green pair.
const cases = [
    { name: "grouped Average", args: ["-respect-parentheses", "(", ...pair, "-intensity", "Average", ")"], hex: "008000ff0000" },
    { name: "grouped Rec709Luma", args: ["-respect-parentheses", "(", ...pair, "-intensity", "Rec709Luma", ")"], hex: "ff0000008000" },
    { name: "ungrouped Average", args: [...pair, "-intensity", "Average"], hex: "008000ff0000" },
    { name: "two frame methods", args: ["-respect-parentheses", "(", ...strip, "-intensity", "Average", ")", "(", ...strip, "-intensity", "Rec709Luma", ")"], hex: average + luma },
    { name: "swapped frame methods", args: ["-respect-parentheses", "(", ...strip, "-intensity", "Rec709Luma", ")", "(", ...strip, "-intensity", "Average", ")"], hex: luma + average },
    { name: "outer override", args: ["-respect-parentheses", "(", ...pair, "-intensity", "Average", ")", "-intensity", "Rec709Luma"], hex: "ff0000008000" },
    { name: "outer reset", args: ["-respect-parentheses", "(", ...pair, "-intensity", "Average", ")", "+intensity"], hex: "ff0000008000" },
    { name: "method before input", args: ["-respect-parentheses", "(", "-intensity", "Average", "in.ppm", ")"], hex: "008000ff0000" }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: sorts using image intensity ($name)`, async ({ args, hex }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n2 1\n255\n"), 255, 0, 0, 0, 128, 0]);
        const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = [...args, "-sort-pixels", "-depth", "8", "rgb:out"];
        let stderr = "";
        const arguments_ = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
