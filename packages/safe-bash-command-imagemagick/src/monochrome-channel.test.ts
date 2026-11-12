import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output, including low-contrast and constant controls.
const pair = ["xc:#999999", "xc:#9a9a9a", "+append"];
const cases = [
    ...["B", "G", "A", "GB", "R", "RGB"].flatMap(channel =>
        [["-monochrome"], ["-type", "Bilevel"], ["+dither", "-monochrome"]].map(operations => ({
            input: pair, operations: ["-channel", channel, ...operations],
            hex: channel.includes("R") || operations[0] === "+dither" ? "000000ffffffffff" : "000000ff000000ff"
        }))),
    { input: ["xc:#9a9a9a", "xc:#999999", "+append"], operations: ["-channel", "B", "-monochrome"], hex: "ffffffffffffffff" },
    { input: ["xc:#303030", "xc:#404040", "+append"], operations: ["-channel", "B", "-monochrome"], hex: "000000ffffffffff" },
    { input: ["xc:#404040"], operations: ["-channel", "B", "-monochrome"], hex: "ffffffff" },
    { input: ["xc:#202020"], operations: ["-channel", "B", "-monochrome"], hex: "000000ff" },
    { input: ["xc:#99999940", "xc:#9a9a9a80", "+append"], operations: ["-channel", "A", "-monochrome"], hex: "000000ff000000ff" },
    { input: pair, operations: ["-channel", "B", "+channel", "-monochrome"], hex: "000000ffffffffff" },
    { input: pair, operations: ["-monochrome"], hex: "000000ffffffffff" },
    { input: pair, operations: [], hex: "999999ff9a9a9aff" },
    { input: pair, operations: ["-channel", "B", "-dither", "FloydSteinberg", "-monochrome"], hex: "000000ff000000ff" },
    { input: ["xc:red", "xc:green", "xc:blue", "+append"], operations: ["-channel", "B", "-monochrome"], hex: "ffffffffffffffffffffffff" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of ["8", "16"]) {
        it.each(cases)(`${mode}, depth ${depth}: $input $operations`, async ({ input, operations, hex }) => {
            const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = [...input, ...operations, "-depth", depth, "-endian", "MSB", "rgba:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(depth === "16" ? [...Buffer.from(hex, "hex")].map(value => value.toString(16).padStart(2, "0").repeat(2)).join("") : hex);
        });
    }
}
