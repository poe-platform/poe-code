import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import cases from "./unique-colors-fixtures.json" with { type: "json" };

// Positioned 3x2 RGBA16 PNG; page results match ImageMagick 7.1.2-35 Q16-HDRI.
const fixture = cases.find(({ name }) => name === "transparent near-identical colors and repeated pixels")!;
const input = Buffer.from(fixture.input, "base64");

for (const mode of ["sync", "map", "retained", "command"]) {
    it.each([
        { operations: [], width: 3, height: 2, page: { width: 9, height: 7, x: 2, y: 1 } },
        { operations: ["-unique-colors"], width: 4, height: 1, page: { width: 12, height: 4, x: 1, y: 0 } },
        { operations: ["+repage", "-unique-colors"], width: 4, height: 1, page: undefined },
        { operations: ["-unique-colors", "+repage"], width: 4, height: 1, page: undefined },
        { operations: ["-repage", "9x7-3-1", "-unique-colors"], width: 4, height: 1, page: { width: 12, height: 4, x: -2, y: -1 } },
    ])(`preserves palette placement and samples for $operations (${mode})`, async ({ operations, width, height, page }) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...operations, "PNG64:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Array.from(output.data16!)).toEqual(operations.includes("-unique-colors") ? fixture.expected : Array.from(decodeImage(input).data16!));
        expect(output.virtualCanvas).toEqual(page);
    });
}
