import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps a cleared read-mask channel from the first frame.
const cases = [
    { name: "first-frame merge mask", input: ["(", "xc:red", "-read-mask", "xc:white", ")", "xc:blue", "-layers", "merge"], channel: "b", expected: "0" },
    { name: "single-frame mosaic mask", input: ["xc:red", "-read-mask", "xc:white", "-mosaic"], channel: "r", expected: "0" },
    { name: "removed merge mask", input: ["(", "xc:red", "-read-mask", "xc:white", ")", "xc:blue", "-layers", "merge", "+read-mask"], channel: "b", expected: "1" },
    { name: "second-frame merge mask", input: ["xc:red", "(", "xc:blue", "-read-mask", "xc:white", ")", "-layers", "merge"], channel: "b", expected: "1" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: matches native $name`, async ({ input, channel, expected }) => {
        const args = [...input, "-format", `%[fx:mean.${channel}]`, "info:-"];
        const filesystem = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
