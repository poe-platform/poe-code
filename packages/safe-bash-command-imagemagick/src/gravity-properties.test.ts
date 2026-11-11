import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const extent = ["-extent", "4x2", "-depth", "8", "rgb:-"];
const pixels = "000000000000000000000000000000000000ff00000000ff";
const cases = [
    { name: "image property placement", options: ["-set", "anchor", "SouthEast", "-gravity", "%[anchor]"], output: extent, hex: pixels },
    { name: "option placement", options: ["-define", "anchor=SouthEast", "-gravity", "%[option:anchor]"], output: extent, hex: pixels },
    { name: "literal placement", options: ["-gravity", "SouthEast"], output: extent, hex: pixels },
    { name: "image property reporting", options: ["-set", "anchor", "East", "-gravity", "%[anchor]"], output: ["-format", "%[gravity]", "info:"], text: "East" },
    { name: "option reporting", options: ["-define", "anchor=East", "-gravity", "%[option:anchor]"], output: ["-format", "%[gravity]", "info:"], text: "East" },
    { name: "invalid literal", options: ["-gravity", "Static"], output: extent, error: "unrecognized gravity type '-gravity' 'Static'" },
    { name: "invalid expanded property", options: ["-set", "anchor", "Static", "-gravity", "%[anchor]"], output: extent, error: "unrecognized gravity type '-gravity' 'Static'" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each(cases)(`expands gravity: $name (${mode})`, async ({ options, output, hex, text, error }) => {
    const argv = ["xc:red", "xc:blue", "+append", "-background", "black", ...options, ...output];
    const filesystem = new MemoryFileSystem();
    let exitCode: number;
    let stderr = "";
    let stdout: Uint8Array;
    if (mode === "command") {
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        exitCode = result.exitCode;
        stdout = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        exitCode = result.exitCode;
        stderr = result.stderr;
        stdout = result.stdoutBytes ?? new TextEncoder().encode(result.stdout);
    }
    expect({ exitCode, stderr }).toEqual({ exitCode: error ? 1 : 0, stderr: error ? `magick: ${error}\n` : "" });
    expect(Buffer.from(stdout).toString(hex ? "hex" : "utf8")).toBe(hex ?? text ?? "");
});
