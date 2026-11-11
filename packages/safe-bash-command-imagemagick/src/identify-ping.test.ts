import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
    { options: [], expected: "85" },
    { options: ["-ping"], expected: "0" },
    { options: ["-ping", "+ping"], expected: "85" },
    { options: ["-ping", "-verbose"], expected: "85" },
    { options: ["-verbose", "-ping"], expected: "0" },
    { options: ["-ping"], expected: "0", inputs: ["/in.pgm", "+ping", "/in.pgm"], second: "85" },
    { options: [], expected: "85", inputs: ["/in.pgm", "-ping", "/in.pgm"], second: "0" }
])(`identify honors explicit ping for PGM pixel expressions (${mode}): $options`, async ({ options, expected, inputs, second }) => {
    const path = "/in.pgm", bytes = Buffer.from("50350a3120310a3235350a55", "hex");
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = [...options, "-format", "%wx%h:%[pixel:p{0,0}];%[pixel:1]|%[mean];", ...(inputs ?? [path])];
    let result;
    if (mode === "sync") result = runIdentifyCliSync(args, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
        let stdout = "", stderr = "";
        const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: 0, stdout: `1x1:gray(${expected});gray(255)|21845;${second === undefined ? "" : `1x1:gray(${second});gray(255)|21845;`}`, stderr: "" });
});
