import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 reference pixels.
const cases = [
    { first: "Point", second: "Triangle", expected: "800800402d40405240007880" },
    { first: "Triangle", second: "Point", expected: "800000582028286058008080" },
    { first: "Point", second: "", expected: "800400402b40405440007b80" },
    { first: "", second: "Point", expected: "7f00005a202525605a00807f" },
    { first: "", second: "", expected: "7f04005a2b2525545a007b7f" },
    { first: "Triangle", second: "Point", reset: true, expected: "7f04005a2b2525545a007b7f" },
    { first: "Triangle", second: "Triangle", global: true, expected: "800000402040406040008080" },
    { first: "", second: "", global: true, expected: "800000402040406040008080" },
];

for (const placement of ["before", "after"] as const)
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each(cases)(`${mode}, ${placement}: morph uses source filters $first / $second (global: $global, reset: $reset)`, async ({ first, second, expected, global = false, reset = false }) => {
    const argv = [
        ...(global ? [] : ["-respect-parentheses"]),
        "(", "-size", "1x3", ...(placement === "before" && first ? ["-filter", first] : []), "gradient:red-blue", ...(placement === "after" && first ? ["-filter", first] : []), ")",
        "(", "-size", "1x5", ...(placement === "before" && second ? ["-filter", second] : []), "gradient:black-lime", ...(placement === "after" && second ? ["-filter", second] : []), ")",
        ...(global ? ["-filter", "Point"] : []),
        ...(reset ? ["+filter"] : []),
        "-morph", "1", "-delete", "0,2", "-depth", "8", "rgb:-",
    ];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
