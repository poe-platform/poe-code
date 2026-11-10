import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick fixtures from 3x4 RGB bytes (7*i+1)%256, with -depth 8.
// Expected interlace values verified with native identify on these exact bytes.
const fixtures = [
    { name: "interlacedGif", bytes: Buffer.from("R0lGODlhAwAEAPMAAAEIDxYdJCsyOUBHTlVcY2pxeH+GjZSboqmwt77FzNPa4ejv9gAAAAAAAAAAAAAAACH5BAAAAAAALAAAAAADAAQAQAQJEASR1DIHDVIiADs=", "base64"), expected: "GIF" },
    { name: "plainGif", bytes: Buffer.from("R0lGODlhAwAEAPMAAAEIDxYdJCsyOUBHTlVcY2pxeH+GjZSboqmwt77FzNPa4ejv9gAAAAAAAAAAAAAAACH5BAAAAAAALAAAAAADAAQAAAQJEAQxSDEHJbUiADs=", "base64"), expected: "None" },
    { name: "interlacedPng", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAAGzSCLGAAAAL0lEQVQI12Ng5OBn0DayZKxv69XS0mIQk1VhmDJ7EaODu5+oqKioqCjjvqNnICwAtsIJCihJDX8AAAAASUVORK5CYII=", "base64"), expected: "PNG" },
    { name: "plainPng", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAHklEQVQI12Nk5OAXFRUVFRVlsbe3R2cx7jt6BsICAF1wBeRbopgJAAAAAElFTkSuQmCC", "base64"), expected: "None" },
    { name: "progressiveJpeg", bytes: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgARCAAEAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQBAQAAAAAAAAAAAAAAAAAAAAP/2gAMAwEAAhADEAAAAUlh/8QAFhABAQEAAAAAAAAAAAAAAAAABgQU/9oACAEBAAEFApQxzP8A/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFxAAAwEAAAAAAAAAAAAAAAAAAAIkQf/aAAgBAQAGPwJI8P/EABcQAAMBAAAAAAAAAAAAAAAAAAABwdH/2gAIAQEAAT8huZYf/9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFxAAAwEAAAAAAAAAAAAAAAAAAAFxkf/aAAgBAQABPxCHdWP/2Q==", "base64"), expected: "JPEG" },
    { name: "mixedFrames", bytes: Buffer.from("R0lGODlhAwAEAPMAAAEIDxYdJCsyOUBHTlVcY2pxeH+GjZSboqmwt77FzNPa4ejv9gAAAAAAAAAAAAAAACH5BAAAAAAALAAAAAADAAQAQAQJEASR1DIHDVIiACH5BAAAAAAALAAAAAADAAQAAAQJEAQxSDEHJbUiADs=", "base64"), expected: "GIFNone" }
];

for (const route of ["sync", "map", "sdk", "identify", "magick"] as const) {
    it.each(fixtures.flatMap(fixture => fixture.name === "mixedFrames" ? [
        { ...fixture, selector: "", expected: "GIFNone" },
        { ...fixture, selector: "[0]", expected: "GIF" },
        { ...fixture, selector: "[1]", expected: "None" }
    ] : [{ ...fixture, selector: "" }]))(`reports input interlacing (${route}): $name $selector`, async ({ bytes, expected, selector }) => {
        const filesystem = new MemoryFileSystem(), files = new Map([["/input", bytes]]);
        await filesystem.writeFile("/input", bytes);
        const args = ["-format", "%[interlace]", `/input${selector}`];
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
