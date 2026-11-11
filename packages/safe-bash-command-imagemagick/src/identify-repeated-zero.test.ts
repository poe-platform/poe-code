import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: two frames with green and red first pixels.
const bytes = Uint8Array.from(Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64"));

for (const mode of ["sync", "buffered", "retained", "identify", "magick"] as const)
it.each([
    { selector: "0,1,0", scenes: [0, 1, 1], red: [0, 1, 0] },
    { selector: "0,1,0,0", scenes: [0, 1, 1, 2], red: [0, 1, 0, 0] },
    { selector: "1,0,0", scenes: [1, 0, 1], red: [1, 0, 0] },
    { selector: "0,1,0,1,0", scenes: [0, 1, 1, 1, 2], red: [0, 1, 0, 1, 0] },
    { selector: "1,0,1", scenes: [1, 0, 1], red: [1, 0, 1] },
    { selector: "0,1", scenes: [0, 1], red: [0, 1] }
])(`${mode}: labels recurring scene zero independently of decoded pixels [$selector]`, async ({ selector, scenes, red }) => {
    const files = new Map([["/clip.gif", bytes]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/clip.gif", bytes);
    // Repeating the operand also checks that the zero-scene counter resets per input.
    const args = ["-format", "%s:%[scene]:%p:%n:%[fx:p{0,0}.r];", `/clip.gif[${selector}]`, `/clip.gif[${selector}]`];
    let result;
    if (mode === "sync") result = runIdentifyCliSync(args, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    else {
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments(mode === "magick" ? ["identify", ...args] : args);
        let stdout = "", stderr = "";
        const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
    }
    const stdout = scenes.map((scene, index) => `${scene}:${scene}:${index}:${scenes.length}:${red[index]};`).join("").repeat(2);
    expect(result).toEqual({ exitCode: 0, stdout, stderr: "" });
});
