import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick: 2x1 green followed by 1x1 red.
const clip = Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64");
// Native ImageMagick: 3x3 red followed by 1x1 blue at +1+1.
const gif = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwADAAACA4R/BQAh+QQAFAAAACwBAAEAAQABAIAAAP8AAAACAkQBADs=", "base64");

for (const route of ["sync", "map", "sdk", "identify", "magick"] as const) {
    it.each([
        { inputs: ["/movie.gif"], options: [], bytes: clip, expected: "0:2x1:0;1:1x1:1;" },
        { inputs: ["/movie.gif[1]"], options: [], bytes: clip, expected: "1:1x1:1;" },
        { inputs: ["/movie.gif"], options: [], expected: "0:3x3:1;1:1x1:0;" },
        { inputs: ["/movie.gif"], options: ["-ping"], expected: "0:3x3:1;1:1x1:0;" },
        { inputs: ["/movie.gif[1]", "/movie.gif", "/movie.gif[0]"], options: [], expected: "1:1x1:0;0:3x3:1;1:1x1:0;0:3x3:1;" },
        { inputs: ["/movie.gif", "/movie.gif"], options: ["-ping"], expected: "0:3x3:1;1:1x1:0;0:3x3:1;1:1x1:0;" }
    ])(`formats every GIF frame in input order (${route}): $inputs $options`, async ({ inputs, options, expected, bytes = gif }) => {
        const filesystem = new MemoryFileSystem(), files = new Map([["/movie.gif", bytes]]);
        await filesystem.writeFile("/movie.gif", bytes);
        const args = [...options, "-format", "%s:%wx%h:%[fx:p{0,0}.r];", ...inputs];
        let result;
        if (route === "identify" || route === "magick") {
            const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
            const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
            let stdout = "", stderr = "";
            const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            result = { ...status, stdout, stderr };
        } else result = route === "sync" ? runIdentifyCliSync(args, files) : await runIdentifyCli(args, route === "map" ? files : { filesystem, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
