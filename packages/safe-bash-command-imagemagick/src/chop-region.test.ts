import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

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
