import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0], green = [0, 255, 0], blue = [0, 0, 255], white = [255, 255, 255], black = [0, 0, 0];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // ImageMagick 7.1.2-35 accepts positive scene signs in duplicate operands only.
    it.each([
        { operation: "-duplicate", spec: "1,+2", tail: [blue] },
        { operation: "-duplicate", spec: "1,0,+2", tail: [red, blue] },
        { operation: "-duplicate", spec: "1,2+1", tail: [blue, green] },
        { operation: "-duplicate", spec: "1,2+0", tail: [blue, red] },
        { operation: "-duplicate", spec: "1,2,+1", tail: [blue, green] },
        { operation: "-clone", spec: "2+1", tail: null },
        { operation: "-duplicate", spec: "1,2++1", tail: null },
        { operation: "-duplicate", spec: "1,2+", tail: null },
        { operation: "-duplicate", spec: "1,1-+2", tail: [green, blue], appendBlack: true },
        { operation: "-duplicate", spec: "1,2", tail: [blue] },
        { operation: "-duplicate", spec: "1,0,2", tail: [red, blue] },
        { operation: "-clone", spec: "1,+2", tail: null },
        { operation: "-clone", spec: "+2", tail: null },
        { operation: "-clone", spec: "1-+2", tail: null },
        { operation: "-duplicate", spec: "1,++2", tail: null },
        { operation: "-duplicate", spec: "1,+", tail: null },
        { operation: "-duplicate", spec: "1,1-+", tail: null },
        { operation: "-duplicate", spec: "1,+4", tail: null }
    ])(`${mode}: $operation '$spec' matches native status and destination bytes`, async ({ operation, spec, tail, appendBlack }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", operation, spec,
            ...(appendBlack ? ["xc:black"] : []), "+append", "-depth", "8", "rgb:out"];
        let exitCode: number;
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
        }
        expect(exitCode).toBe(tail === null ? 1 : 0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect([...output]).toEqual(tail === null ? [...keep]
            : [red, green, blue, white, ...tail, ...(appendBlack ? [black] : [])].flat());
    });
}
