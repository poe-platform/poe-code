import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { splice: "0x0", operation: [], info: true },
        { splice: "1x1", operation: [], info: true },
        { splice: "0x0", operation: ["-negate"] },
        { splice: "1x1", operation: ["-negate"] },
        { splice: "0x0", operation: [] },
        { splice: "0x0", operation: ["-channel", "RGB", "-negate", "+channel"] },
        { operation: ["-negate"] },
        { splice: "1x1", operation: [], background: "none", info: true },
        { splice: "0x0", operation: [], background: "none", info: true },
        { splice: "1x1", operation: [], alpha: true, info: true }
    ])(`preserves native splice alpha (${mode}): %j`, async ({ splice, operation, info, background, alpha }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
        const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
        const args = ["in.ppm", ...(alpha ? ["-alpha", "on"] : []), "-background", background ?? "#123456", ...(splice ? ["-splice", splice] : []), ...operation,
            ...(info ? ["-format", "%[channels]", "info:out"] : ["PNG32:out"])];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const diagnostics: string[] = [];
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(data) { diagnostics.push(new TextDecoder().decode(data)); } } });
            expect(result.exitCode).toBe(0);
            expect(diagnostics.join("")).toBe("");
        } else {
            const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        const bytes = mode === "buffered" ? files.get("out")! : await filesystem.readFile("/out");
        if (info) {
            expect(new TextDecoder().decode(bytes)).toBe(background === "none" || alpha ? "srgba 4.0" : "srgb  3.0");
        } else {
            const output = decodeImage(bytes), added = splice === "1x1" ? 1 : 0;
            expect([output.width, output.height]).toEqual([4 + added, 3 + added]);
            const expected = [];
            for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
                const offset = ((y - added) * 4 + x - added) * 3;
                const rgb = x < added || y < added ? [18, 52, 86] : [offset * 7, (offset + 1) * 7, (offset + 2) * 7];
                expected.push(...rgb.map(value => operation.some(value => value === "-negate") ? 255 - value : value), 255);
            }
            expect(output.data).toEqual(Uint8Array.from(expected));
        }
    });
}
