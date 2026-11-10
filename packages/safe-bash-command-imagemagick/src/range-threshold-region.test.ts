import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = {
    color: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64"),
    alpha: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAHElEQVR4nGNkYGBgULR2dseFmUS5NYXx4cGgAAANORS26MpKWAAAAABJRU5ErkJggg==", "base64"),
};

// Native ImageMagick 7.1.2-35 Q16-HDRI; SHA-256 of decoded 8-bit RGBA pixels.
const cases = [
    { name: "translucent region", input: inputs.alpha, region: true, expected: "11922ecbbe5f43868fc2fa1e87d220991598031342f560dcc66378453f37f724" },
    { name: "opaque region", input: inputs.color, region: true, expected: "bd93c800a037455d9f34b437c4b6c96c072a6d10730f4261ef331fdb8893f80a" },
    { name: "opaque unmasked control", input: inputs.color, region: false, expected: "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7" },
    { name: "translucent unmasked control", input: inputs.alpha, region: false, expected: "5e2a97aa97d61efd0690cc4e7a7e04c509f6e8274bbcf2828b2d2d5018c06cba" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: range threshold matches native $name`, async ({ input, region, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", original);
        const argv = ["/in.png", "-seed", "17", ...(region ? ["-region", "3x2+1+1"] : []), "-range-threshold", "10,30,60,90%", ...(region ? ["+region"] : []), "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([8, 6]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
    });
}
