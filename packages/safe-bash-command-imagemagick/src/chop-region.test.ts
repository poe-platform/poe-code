import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import { chopRegion, regionContains } from "./region.js";

it("retains each surviving mask pixel for cuts through either side of a wrapped selection", () => {
    for (let start = 0; start < 5; start++) for (let length = 0; length <= 5; length++) {
        for (let from = 0; from < 5; from++) for (let to = from; to <= 5; to++) {
            if (to - from === 5) continue;
            for (const horizontal of [true, false]) {
                const region = { x: horizontal ? start : 0, y: horizontal ? 0 : start,
                    width: horizontal ? length : 1, height: horizontal ? 1 : length,
                    wrap: { width: horizontal ? 5 : 1, height: horizontal ? 1 : 5 } };
                const chopped = chopRegion(region, horizontal ? from : 0, horizontal ? 0 : from,
                    horizontal ? to : 0, horizontal ? 0 : to);
                const before = Array.from({ length: 5 }, (_, pixel) => regionContains(region, horizontal ? pixel : 0, horizontal ? 0 : pixel));
                before.splice(from, to - from);
                const after = Array.from({ length: before.length }, (_, pixel) => regionContains(chopped, horizontal ? pixel : 0, horizontal ? 0 : pixel));
                expect(after).toEqual(before);
            }
        }
    }
});

// Opaque 7x5 RGBA8 pixels numbered 1–35 by their red channel.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTY6MjMrMDA6MDBt6QBDAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjU2OjIzKzAwOjAwHLS4/wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1NjoyMyswMDowMEuhmSAAAAAaSURBVAjXY2T8z/Cf8T87AzbMwv7TkIHOkgD8kCWn+X/EIQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { name: "overlapping cut", region: "3x2+1+1", chop: "2x1+2+1", width: 5, landmarks: [[1, 1, "ef0f9600"], [2, 1, "13ed7eff"], [3, 1, "14ec85ff"]] },
        { name: "cut before selection", region: "3x2+3+2", chop: "2x1+0+0", width: 5, landmarks: [[0, 1, "11ef70ff"], [1, 1, "ed118800"], [3, 2, "e41a4900"], [1, 3, "20e0d9ff"]] },
        { name: "selection across cut", region: "5x3+1+1", chop: "2x1+2+2", width: 5, landmarks: [[0, 1, "08f831ff"], [1, 1, "f608c700"], [3, 2, "e41a4900"], [4, 1, "0ef25bff"]] },
        { name: "selection removed", region: "2x1+2+1", chop: "2x1+2+1", width: 5, landmarks: [[1, 1, "10f069ff"], [2, 1, "13ed7eff"], [3, 1, "14ec85ff"]] },
        { name: "cut after selection", region: "2x2+1+1", chop: "1x1+5+4", width: 6, landmarks: [[1, 1, "f608c700"], [2, 1, "f509c000"], [3, 1, "0bf546ff"]] },
    ] as const)(`carries the region mask with surviving pixels: $name (${mode})`, async ({ region, chop, width, landmarks }) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-region", region, "-chop", chop, "-negate", "+region", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, 4]);
        // Stable landmarks in 24 native ImageMagick 7.1.2-35 Q16-HDRI runs.
        // Other native pixels vary, so do not assert a whole-image snapshot.
        for (const [x, y, rgba] of landmarks) {
            expect(Buffer.from(output.data.subarray((width * y + x) * 4, (width * y + x + 1) * 4)).toString("hex")).toBe(rgba);
        }
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operations: ["-roll", "+3+2", "-chop", "1x1+1+1"], expected: "ff0000ff00000000ff0000ff" },
        { operations: ["-roll", "+3+2"], expected: "ffff0000ff00000000000000000000ffff0000ff" },
        { operations: ["-chop", "1x1+1+1"], expected: "0000000000ffff0000000000" },
    ])(`preserves surviving selected pixels: $operations (${mode})`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "5x4", "xc:black", "-region", "3x2+1+1", ...operations, "-negate", "+region", "-depth", "8", "gray:/out.gray"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gray") : files.get("/out.gray")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
