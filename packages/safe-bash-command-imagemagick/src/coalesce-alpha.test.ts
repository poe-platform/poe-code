import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: each separated plane is an opaque RGBA pixel.
const red = "ffffffff000000ff000000ff";
const cases = [
    { name: "one RGB frame", input: ["xc:red"], expected: red },
    { name: "two RGB frames", input: ["xc:red", "xc:red"], expected: red.repeat(2) },
    { name: "explicit opaque alpha", input: ["xc:red", "-alpha", "set"], expected: red + "ffffffff" },
    { name: "translucent alpha", input: ["xc:#ff000080"], expected: red + "808080ff" },
    { name: "transparent overlay on RGB", input: ["xc:red", "xc:none"], expected: red.repeat(2) },
    { name: "background disposal activates alpha", input: ["-dispose", "Background", "xc:red", "-dispose", "None", "xc:none"], expected: red + "000000ff".repeat(4) }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const operation of [[], ["-coalesce"], ["-layers", "Coalesce"]]) {
        it.each(operation.length ? cases : cases.slice(0, 2))(`${mode}, ${operation.join(" ") || "plain separation"}: $name`, async ({ input, expected }) => {
            const argv = ["-size", "1x1", ...input, ...operation, "-separate", "-depth", "8", "rgba:-"];
            const stdout: Uint8Array[] = [];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
                fs: new MemoryFileSystem(), signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, new Map()) : await runMagickCli(argv, new Map());
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        });
    }
}
