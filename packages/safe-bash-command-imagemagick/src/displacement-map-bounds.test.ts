import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: flatten clears outside a smaller displacement
// map to transparent black; direct composite on an opaque destination uses black.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["flatten", "composite"])
for (const compose of ["Displace", "Distort", "Over"])
for (const size of ["2x2", "4x3"])
it.each([8, 16])(`${route}: ${operation} ${compose} ${size} map, depth=%s`, async depth => {
    const argv = operation === "flatten"
        ? ["-respect-parentheses", "-size", "4x3", "xc:red", "(", "-size", size, "xc:#808080", "-compose", compose, ")", "-flatten"]
        : ["-size", "4x3", "xc:red", "-size", size, "xc:#808080", "-compose", compose, "-composite"];
    argv.push("-depth", String(depth), "-endian", "MSB", "rgba:-");
    const filesystem = new MemoryFileSystem();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const expected = Array.from({ length: 12 }, (_, pixel) => {
        const inside = size === "4x3" || pixel % 4 < 2 && pixel < 8;
        return compose === "Over" ? inside ? [128, 128, 128, 255] : [255, 0, 0, 255]
            : inside ? [255, 0, 0, 255] : [0, 0, 0, operation === "flatten" ? 0 : 255];
    }).flat().flatMap(value => depth === 16 ? [value, value] : [value]);
    const output = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
    expect(output.toString("hex")).toBe(Buffer.from(expected).toString("hex"));
});
