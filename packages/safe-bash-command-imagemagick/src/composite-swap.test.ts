import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, identical PPM inputs and KEEP destinations.
for (const route of ["magick", "composite", "retained", "buffered", "sync"] as const)
it.each([
    { name: "indexed swap", options: ["-swap", "0,1"], hex: "65141e83323ca1505a" },
    { name: "same index", options: ["-swap", "0,0"], hex: "0a6f79288d9746abb5" },
    { name: "shorthand", options: ["+swap"], hex: "65141e83323ca1505a" },
    { name: "reversed inputs", options: [], reverse: true, hex: "65141e83323ca1505a" },
    { name: "negative indices", options: ["-swap", "-2,-1"], hex: "65141e83323ca1505a" },
    { name: "repeated swap", options: ["-swap", "0,1", "-swap", "0,1"], hex: "0a6f79288d9746abb5" },
    { name: "swap before inputs", options: ["-swap", "0,1"], before: true, hex: "65141e83323ca1505a" },
])(`${route}: composite $name`, async ({ options, hex, reverse, before }) => {
    const files = new Map([
        ["/a.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
        ["/b.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
        ["/out.raw", new TextEncoder().encode("KEEP")],
        ["/side.raw", new TextEncoder().encode("KEEP")]
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const inputs = reverse ? ["/b.ppm", "/a.ppm"] : ["/a.ppm", "/b.ppm"];
    const argv = ["-compose", "CopyRed", ...(before ? options : []), ...inputs, ...(before ? [] : options), "rgb:/out.raw"];
    const argumentValues = createCommandArguments(route === "magick" ? ["composite", ...argv] : argv);
    let stdout = "", stderr = "";
    const command = route === "magick" || route === "composite";
    const result = command ? await (route === "magick" ? createMagickCommand() : createCompositeCommand()).execute({
        command: route, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runCompositeCliSync(argv, files)
        : await runCompositeCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stdout: "stdout" in result ? result.stdout : stdout,
        stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const [path, expected] of [["/out.raw", hex], ["/side.raw", "4b454550"]]) {
        const output = command || route === "retained" ? await filesystem.readFile(path!) : files.get(path!)!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    }
});
