import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves strictly increasing scenes.
const input = Buffer.from("50350a3120310a3235350a1150350a3120310a3235350a5550350a3120310a3235350acc", "hex");

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const intermediate of [false, true])
for (const target of ["", "out"])
it.each([
    { selector: "[0,2]", options: [], expected: "0/0/0;2/2/1;" },
    { selector: "", options: ["-delete", "1"], expected: "0/0/0;2/2/1;" },
    { selector: "[2,0]", options: [], expected: "2/2/0;3/3/1;" },
    { selector: "[0-1]", options: [], expected: "0/0/0;1/1/1;" },
    { selector: "[0,2,0]", options: [], expected: "0/0/0;1/1/1;2/2/2;" },
    { selector: "[0,2]", options: ["-scene", "0"], expected: "0/0/0;1/1/1;" },
    { selector: "[0,2]", options: ["-scene", "5"], expected: "5/5/0;6/6/1;" }
])(`${mode}: INFO scene gaps, write=${intermediate}, target=${target}: $selector $options`, async ({ selector, options, expected }) => {
    const files = new Map([["in.pgm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pgm", input);
    const args = [`in.pgm${selector}`, ...options, "-format", "%s/%[scene]/%p;",
        ...(intermediate ? ["-write", `info:${target}`, "null:"] : [`info:${target}`])];
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stdout" in result) stdout = String(result.stdout);
    if ("stderr" in result) stderr = String(result.stderr);
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: target ? "" : expected, stderr: "" });
    if (target) {
        const output = mode === "buffered" || mode === "sync" ? files.get(target)! : await filesystem.readFile(`/${target}`);
        expect(new TextDecoder().decode(output)).toBe(expected);
    }
});
