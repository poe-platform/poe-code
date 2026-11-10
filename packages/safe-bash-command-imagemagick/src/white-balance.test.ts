import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./white-balance-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: input.png -white-balance PNG32:output.png,
// decoded with: magick output.png -depth 8 rgba:-.
const cases = [
    ...[...fixtures.map(fixture => ({ ...fixture, copies: 1 })), { ...fixtures[0]!, name: "gradient across chunk boundaries", copies: 65 }]
        .map(fixture => ({ ...fixture, operations: ["-white-balance"] })),
    // RGB input: ff0010 ff2010 fa100a 1060ff. Native Q16-HDRI samples,
    // including explicit-clamp controls for the out-of-range blue channel.
    ...[
        { operations: ["-white-balance", "-evaluate", "Divide", "2"], rgba: "663017ff653317ff643015ff005f9bff" },
        { operations: ["-white-balance", "-clamp", "-evaluate", "Divide", "2"], rgba: "663017ff653317ff643015ff005f80ff" },
        { operations: ["-white-balance", "-white-balance"], rgba: "b36f41ffb17543ffb06e3dff00ffffff" },
        { operations: ["-white-balance", "-clamp", "-white-balance"], rgba: "b66d48ffb4734affb26c44ff00f8ffff" },
        { operations: ["-white-balance"], rgba: "cc5f2dffca662fffc86029ff00bfffff" },
        { operations: ["-evaluate", "Divide", "2"], rgba: "800008ff801008ff7d0805ff083080ff" }
    ].flatMap(sample => [1, 129].map(copies => ({
        ...sample, copies, name: `${sample.operations.join(" ")} (${copies} rows)`,
        input: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAFUlEQVR4nGP8zyDAoMDw+8MvsYCvAB3/BXEuzWDoAAAAAElFTkSuQmCC"
    })))
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`white-balances $name with native pixels via ${mode}`, async ({ input, rgba, copies, operations }) => {
        let bytes: Uint8Array = Buffer.from(input, "base64");
        if (copies > 1) {
            const image = decodeImage(bytes);
            const repeated = sharp(Buffer.concat(Array.from({ length: copies }, () => image.data)), {
                raw: { width: image.width, height: image.height * copies, channels: 4 }
            });
            bytes = await (image.hasAlpha ? repeated : repeated.removeAlpha()).png().toBuffer();
        }
        const files = new Map([["input.png", bytes]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file white balance forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const args = ["input.png", ...operations, "PNG32:output.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage((mode === "retained" || mode === "command") ? await fs.readFile("/output.png") : files.get("output.png")!);
        const original = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([original.width, original.height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba.repeat(copies));
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG64 decoded as little-endian RGBA16.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "over-range samples", operations: ["-evaluate", "Multiply", "1.5"], rgba: "ffff10b1f95cffffb9d5bcdfabbcffff7815ae4a7a7effff6f076831b54bffff" },
        { name: "explicitly clamped samples", operations: ["-evaluate", "Multiply", "1.5", "-clamp"], rgba: "42f4b2ad7d59ffffeddcd9dd59baffff531d104ac47dffff480c17314d4bffff" },
        { name: "recovered samples", operations: ["-evaluate", "Multiply", "1.5", "-evaluate", "Divide", "1.5"], rgba: "61b93474bb39ffff8f94b493c279ffff3b173431f152ffff210b9e209b31ffff" },
        { name: "original samples", operations: [], rgba: "61b93474bb39ffff8f94b493c279ffff3b173431f152ffff210b9e209b31ffff" }
    ])(`white-balances $name at native precision via ${mode}`, async ({ operations, rgba }) => {
        const bytes = await sharp(Buffer.from("c07030a09070203050102030", "hex"), {
            raw: { width: 4, height: 1, channels: 3 }
        }).png().toBuffer();
        const files = new Map([["input.png", bytes]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const args = ["input.png", ...operations, "-white-balance", "PNG64:output.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage((mode === "retained" || mode === "command") ? await fs.readFile("/output.png") : files.get("output.png")!);
        const expected = Buffer.from(rgba, "hex");
        expect(Array.from(output.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16LE(index * 2)));
    });
}
