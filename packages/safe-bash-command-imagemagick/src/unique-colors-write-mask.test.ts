import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const indices = [1, 2, 3, 0, 3, 1, 0, 2];
const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(indices.flatMap(i => colors[i]!))]);
const fine = Buffer.alloc(48);
indices.flatMap(i => [10000 + i, 22000 - i, 32000 + i]).forEach((value, index) => fine.writeUInt16BE(value, index * 2));
const fineInput = Buffer.concat([Buffer.from("P6\n4 2\n65535\n"), fine]);
const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 0, 255, 255, 255, 0, 255, 0])]);
// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded RGBA16 in big-endian order.
const cases = [
    { name: "retained mask", input, operations: ["-unique-colors"], height: 1,
        hex: "8c8c26265d5d00005c5cf0f07e7e00000b0b4b4bfefe0000f8f81d1da2a20000" },
    { name: "negate with mask", input, operations: ["-unique-colors", "-negate", "+write-mask"], height: 1,
        hex: "7373d9d9a2a2ffffa3a30f0f8181fffff4f4b4b40101ffff0707e2e25d5dffff" },
    { name: "16-bit negate with mask", input: fineInput, operations: ["-unique-colors", "-negate", "+write-mask"], height: 1,
        hex: "d8eeaa1082feffffd8edaa1182fdffffd8ecaa1282fcffffd8efaa0f82ffffff" },
    { name: "remove mask before negate", input, operations: ["-unique-colors", "+write-mask", "-negate"], height: 1,
        hex: "7373d9d9a2a2ffffa3a30f0f8181fffff4f4b4b40101ffff0707e2e25d5dffff" },
    { name: "negate without palette extraction", input, operations: ["-negate", "+write-mask"], height: 2,
        hex: "f4f4b4b40101ffffa3a30f0f8181ffff8c8c26265d5dfffff8f81d1da2a2ffff8c8c26265d5dfffff4f4b4b40101fffff8f81d1da2a2ffffa3a30f0f8181ffff" }
];

for (const mode of ["sync", "map", "retained", "command"] as const) for (const fixture of cases) {
    it(`matches native unique-color write-mask pixels: ${fixture.name} (${mode})`, async () => {
        const files = new Map([["/in.ppm", fixture.input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-write-mask", "/mask.pgm", ...fixture.operations, "PNG64:/out"];
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
        expect([output.width, output.height]).toEqual([4, fixture.height]);
        const expected = Buffer.from(fixture.hex, "hex");
        expect(Array.from(output.data16 ?? output.data, value => output.data16 ? value : value * 257))
            .toEqual(Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16BE(i * 2)));
    });
}
