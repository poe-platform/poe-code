import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
    // PNG pHYs fixtures checked with native identify: meters and unknown units.
    { path: "/tag.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAC4jAAAXEgGVQubbAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"), units: "PixelsPerCentimeter" },
    { path: "/unknown.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAEAAAAAgA0xQamAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"), units: "Undefined" },
    { path: "/tile.ppm", bytes: Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]), units: "Undefined" }
])(`identify expands resolution units (${mode}): $path`, async ({ path, bytes, units }) => {
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = ["-format", "%U|%[units]|%%U", path];
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
    expect(result).toEqual({ exitCode: 0, stdout: `${units}|${units}|%U`, stderr: "" });
});
