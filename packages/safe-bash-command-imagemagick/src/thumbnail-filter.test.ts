import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: grid.png [-filter FILTER] -thumbnail 4x3 PNG32:out.png.
// Native `magick out.png -depth 8 rgba:-` produces three identical rows.
for (const [filter, row] of [
    [undefined, [180, 111, 140, 142, 110, 122, 169, 121, 141, 153, 118, 147, 105, 137, 133, 135]],
    ["Lanczos", [180, 111, 140, 142, 112, 122, 168, 121, 139, 153, 119, 146, 106, 137, 133, 134]],
    ["LanczosSharp", [180, 111, 140, 142, 110, 122, 169, 121, 141, 153, 118, 147, 105, 137, 133, 135]],
    ["Mitchell", [172, 113, 143, 142, 116, 124, 162, 123, 139, 149, 120, 141, 108, 140, 132, 136]]
] as const) for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`matches native ${filter ?? "default"} thumbnail filtering (${mode})`, async () => {
        const input = readFileSync(new URL("./fixtures/thumbnail/grid.png", import.meta.url));
        const files = new Map([["grid.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/grid.png", input);
        const args = ["grid.png", ...(filter ? ["-filter", filter] : []), "-thumbnail", "4x3", "PNG32:out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([4, 3]);
        expect([...output.data]).toEqual([...row, ...row, ...row]);
    });
}
