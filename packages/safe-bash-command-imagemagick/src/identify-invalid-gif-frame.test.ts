import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Two frames, 2x1 and 1x1. ImageMagick 7.1.2-35 rejects frame 2 and continues the batch.
const gif = Uint8Array.from(Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64"));

for (const mode of ["sync", "buffered", "retained", "identify", "magick"])
it.each([
    { inputs: ["clip.gif[2]", "a.ppm"], stdout: "1x1;", invalid: true },
    { inputs: ["b.ppm", "clip.gif[2]", "a.ppm"], stdout: "2x1;1x1;", invalid: true },
    { inputs: ["clip.gif[2]"], stdout: "", invalid: true },
    { inputs: ["clip.gif[0]", "a.ppm"], stdout: "2x1;1x1;", invalid: false }
])(`validates single GIF frame indices without dropping other inputs (${mode}): $inputs`, async ({ inputs, stdout: expectedStdout, invalid }) => {
    const files = new Map([
        ["clip.gif", gif],
        ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
        ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 255 0 0 255 0\n")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const args = ["-format", "%wx%h;", ...inputs];
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
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
    }
    expect(result.stdout).toBe(expectedStdout);
    expect(result.exitCode).toBe(invalid ? 1 : 0);
    if (invalid) expect(result.stderr).toContain("invalid image index 2");
    else expect(result.stderr).toBe("");
});
