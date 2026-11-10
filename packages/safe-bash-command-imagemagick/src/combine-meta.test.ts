import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: extra combine inputs become meta planes.
const inputs = ["404040", "808080", "c0c0c0", "cccccc", "606060", "909090"].map(color => `xc:#${color}`);
const cases = [
    { name: "five-channel metadata", count: 5, options: ["-colorspace", "sRGB", "-combine", "-format", "%[colorspace] %[channels]"], output: "info:out", expected: "sRGB srgba 5.1" },
    { name: "six-channel metadata", count: 6, options: ["-colorspace", "sRGB", "-combine", "-format", "%[colorspace] %[channels]"], output: "info:out", expected: "sRGB srgba 6.2" },
    { name: "fifth plane", count: 5, channel: "meta0", expected: "606060ff" },
    { name: "sixth plane", count: 6, channel: "meta1", expected: "909090ff" },
    { name: "missing meta control", count: 4, channel: "meta0", expected: "000000ff" },
    { name: "alpha control", count: 4, channel: "A", expected: "ccccccff" },
    { name: "alpha with meta planes", count: 6, channel: "A", expected: "ccccccff" },
    { name: "RGBA export control", count: 6, options: ["-combine", "-depth", "8"], expected: "4080c0cc" },
    { name: "meta plane across chunks and rows", count: 5, size: "4097x2", channel: "meta0", expected: "606060ff".repeat(4097 * 2) },
    { name: "colored meta input intensity", count: 5, extra: "xc:red", channel: "meta0", expected: "363636ff" },
    { name: "16-bit meta precision", count: 5, extra: "xc:#123412341234", depth: "16", channel: "meta0", expected: "123412341234ffff" },
    { name: "multiple meta selection", count: 6, channel: "meta0,meta1", append: true, expected: "606060ff909090ff" },
    { name: "missing second meta plane", count: 5, channel: "meta1", expected: "000000ff" },
    { name: "separated channel count", count: 5, options: ["-combine", "-channel", "R", "-separate", "-format", "%[channels]"], output: "info:out", expected: "gray  1.0" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ count, options, output, channel, expected, size = "1x1", extra, depth = "8", append }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["-size", size, ...inputs.slice(0, count - (extra ? 1 : 0)), ...(extra ? [extra] : []), ...(options ?? ["-combine", "-channel", channel!, "-separate", ...(append ? ["-append"] : []), "-colorspace", "sRGB", "-depth", depth, "-endian", "MSB"]), output ?? "rgba:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const actual = Buffer.from(bytes).toString(output ? "utf8" : "hex");
        if (expected.length > 1024) {
            expect(actual.length).toBe(expected.length);
            expect([...actual].findIndex((value, index) => value !== expected[index])).toBe(-1);
        } else expect(actual).toBe(expected);
    });
}
