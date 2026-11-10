import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255])]);
// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded RGBA8.
const cases = [
    { operation: "-resize", geometry: "2x2!", masked: true, width: 2, height: 2, hex: "697077ff939aa1ffbdc4cbffe7eef5ff" },
    { operation: "-resize", geometry: "5x1!", masked: true, width: 5, height: 1, hex: "a8afb6ffbdc4cbffd2d9e0ffdae1e8ffe8eff6ff" },
    { operation: "-thumbnail", geometry: "2x2!", masked: true, width: 2, height: 2, hex: "697077ff939aa1ffbdc4cbffe7eef5ff" },
    { operation: "-resize", geometry: "2x2!", masked: false, width: 2, height: 2, hex: "222930ff4b5259ff9ca3aaffc5ccd3ff" },
    { operation: "-thumbnail", geometry: "2x2!", masked: false, width: 2, height: 2, hex: "20272eff4a5158ff9da4abffc7ced5ff" },
    { operation: "-resize", geometry: "4x3!", masked: true, width: 4, height: 3, hex: "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff" }
];

for (const mode of ["sync", "map", "retained", "command"] as const) for (const fixture of cases) {
    it(`matches native resize write-mask pixels: ${fixture.operation} ${fixture.geometry} masked=${fixture.masked} (${mode})`, async () => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...(fixture.masked ? ["-write-mask", "/mask.pgm"] : []), fixture.operation, fixture.geometry, "+write-mask", "PNG32:/out"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            expect({ ...result, stdout, stderr }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
        expect([output.width, output.height]).toEqual([fixture.width, fixture.height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(fixture.hex);
    });
}
