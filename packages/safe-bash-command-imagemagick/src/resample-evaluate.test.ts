import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: 7x5 PNG48, RGB level 60000 + 100*i.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFEAIAAABWaL3MAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTk6MTA6MjgrMDA6MDCbzwJdAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE5OjEwOjI4KzAwOjAw6pK64QAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxOToxMDoyOCswMDowML2Hmz4AAABmSURBVAjXdY6xDcAgEAP/IYNQMhADUDAOA1G4ZJr3F4yQghREUTrrrLMsVq1atWnTJjMzMzs7OxcXlxcvXnz48HFFRERIkiRJIBBo06ZtE4VCn/YKCAi/9SmHvbqFbz7J68Df3iY3axdKJQ0qE9IAAAAASUVORK5CYII=", "base64");
const identity = ["-evaluate", "Add", "0"];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operator of ["-sample", "-resize"])
for (const { width, height, columns, rows } of [
    { width: 9, height: 8, columns: [0, 1, 1, 2, 3, 4, 5, 5, 6], rows: [0, 0, 1, 2, 2, 3, 4, 4] },
    { width: 3, height: 2, columns: [1, 3, 5], rows: [1, 3] },
]) {
    it.each([
        { placement: "neither", before: [], after: [] },
        { placement: "before", before: identity, after: [] },
        { placement: "after", before: [], after: identity },
        { placement: "both", before: identity, after: identity },
        { placement: "before and after with unclamped values", before: ["-evaluate", "Add", "10000"], after: ["-evaluate", "Subtract", "10000"] },
        ...(operator === "-sample" ? [{ placement: "both with a write mask", before: [...identity, "-write-mask", "xc:white"], after: ["+write-mask", ...identity] }] : []),
    ])(`${mode}: ${operator} ${width}x${height} preserves every 16-bit pixel with arithmetic $placement`, async ({ before, after }) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...before, "-filter", "point", operator, `${width}x${height}!`, ...after, "PNG48:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data16).toEqual(Uint16Array.from(rows.flatMap(row => columns.flatMap(column => {
            const level = before.includes("-write-mask") ? 0 : 60000 + 100 * (row * 7 + column);
            return [level, level, level, 65535];
        }))));
    });
}
