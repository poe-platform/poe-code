import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output.
const cases = [
    ...[["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-flatten"], ["-mosaic"]].flatMap(operation => [
        { name: `${operation.join(" ")}: translucent layers`, colors: ["#12457880", "#ab8900c0"], operation, hex: "444017c0" },
        { name: `${operation.join(" ")}: single translucent layer`, colors: ["#12457880"], operation, hex: "09233c80" },
        { name: `${operation.join(" ")}: opaque layers`, colors: ["#124578", "#ab8900"], operation, hex: "124578ff" }
    ]),
    { name: "direct composite", colors: ["#12457880", "#ab8900c0"], operation: ["-composite"], hex: "474d2dc0" },
    { name: "merge across storage spans and rows", colors: ["#12457880", "#ab8900c0"], operation: ["-layers", "merge"], hex: "444017c0".repeat(2049 * 2), size: "2049x2" }
];

for (const route of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${route}: DstAtop preserves $name`, async testCase => {
    const { colors, hex, operation } = testCase;
    const argv = ["-size", "size" in testCase ? testCase.size : "1x1", ...colors.map(color => `xc:${color}`), "-background", "none", "-compose", "DstAtop",
        ...operation, "-depth", "8", "rgba:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
