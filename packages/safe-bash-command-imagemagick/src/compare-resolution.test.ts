import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const inputs = new Map(["plain.ppm", "edit.ppm", "inch.tif", "cm.tif"].map(name => [
    name, new Uint8Array(readFileSync(new URL(`./fixtures/compare-resolution-${name}`, import.meta.url)))
]));
// ImageMagick 7.1.2-35 Q16-HDRI; TIFF tags independently inspected with Pillow.
const cases: { first: string; second: string; tags: Record<number, number>; equal: boolean; density?: string }[] = [
    { first: "plain.ppm", second: "edit.ppm", tags: {}, equal: false },
    { first: "inch.tif", second: "plain.ppm", tags: { 282: 300, 283: 150, 296: 2 }, equal: true },
    { first: "inch.tif", second: "edit.ppm", tags: { 282: 300, 283: 150, 296: 2 }, equal: false },
    { first: "cm.tif", second: "edit.ppm", tags: { 282: 40, 283: 80, 296: 3 }, equal: false },
    { first: "plain.ppm", second: "inch.tif", tags: {}, equal: true },
    { first: "inch.tif", second: "edit.ppm", tags: { 282: 90, 283: 45, 296: 2 }, equal: false, density: "90x45" },
    { first: "plain.ppm", second: "edit.ppm", tags: { 282: 300, 283: 150, 296: 1 }, equal: false, density: "300x150" },
    { first: "plain.ppm", second: "edit.ppm", tags: { 282: 72, 283: 72, 296: 1 }, equal: false, density: "72" },
];

function resolutionTags(bytes: Uint8Array): Record<number, number> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const littleEndian = bytes[0] === 0x49;
    const directory = view.getUint32(4, littleEndian);
    const tags: Record<number, number> = {};
    for (let index = 0; index < view.getUint16(directory, littleEndian); index++) {
        const entry = directory + 2 + index * 12;
        const tag = view.getUint16(entry, littleEndian);
        if (tag === 296) tags[tag] = view.getUint16(entry + 8, littleEndian);
        if (tag === 282 || tag === 283) {
            const offset = view.getUint32(entry + 8, littleEndian);
            tags[tag] = view.getUint32(offset, littleEndian) / view.getUint32(offset + 4, littleEndian);
        }
    }
    return tags;
}

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    it.each(cases)(`${mode} preserves first-operand TIFF resolution: $first vs $second`, async ({ first, second, tags, equal, density }) => {
        const files = new Map([...inputs].map(([name, bytes]) => [name, bytes.slice()]));
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const argv = ["-metric", "RMSE", ...(density ? ["-density", density] : []), first, second, "diff.tif"];
        let result;
        if (mode === "compare" || mode === "magick") {
            const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
            const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
            let stdout = "", stderr = "";
            result = { ...await command.execute({ command: command.name, args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr };
        } else result = mode === "sync" ? runCompareCliSync(argv, files)
            : await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
        expect(result).toEqual({ exitCode: equal ? 0 : 1, stdout: "", stderr: equal ? "0 (0)" : "5879.96 (0.0897224)" });
        const read = (name: string) => mode === "sync" || mode === "memory" ? files.get(name)! : filesystem.readFile(`/${name}`);
        const bytes = await read("diff.tif");
        expect(resolutionTags(bytes)).toEqual(tags);
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([8, 6]);
        const rgb = image.data.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(equal
            ? "2766f87642b42b94b3ce8c93d915059adf2b9885fb605a561beb55b29e5263f8"
            : "31f5631eae0d58e29781680128a6148e06eab0437b5233697326240d87823fc8");
        expect(await read(first)).toEqual(inputs.get(first));
        expect(await read(second)).toEqual(inputs.get(second));
    });
}
