import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = {
    gray: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAAAAADbboAnAAAAMklEQVR4nC3JMQEAIRDEwGcdJA1GDnV4oUYgAij4dqZ9VdVXjaCqRDgTduAAm/xDHugF9aMJVQSYsxYAAAAASUVORK5CYII=", "base64"),
    color: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64"),
    alpha: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAHElEQVR4nGNkYGBgULR2dseFmUS5NYXx4cGgAAANORS26MpKWAAAAABJRU5ErkJggg==", "base64"),
};

// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const cases = [
    { name: "grayscale input", input: inputs.gray, options: ["-seed", "17", "-random-threshold", "0x100%"], expected: "a60aa6b14d0bd916600880959f496ff975dc41829affce70ea5e3a63b48a91e4" },
    { name: "converted grayscale", input: inputs.color, options: ["-seed", "17", "-colorspace", "gray", "-random-threshold", "0x100%"], expected: "b440a848ff7b0f29f1c71590e7766852da2753904a9d9920fd4cdfa8080a0fdf" },
    { name: "grayscale with alpha", input: inputs.alpha, options: ["-seed", "17", "-colorspace", "gray", "-random-threshold", "0x100%"], expected: "3c409172a9f24d05127f20c77bffd221b62ccbdce3436f402c9be9f591e86283" },
    { name: "independent color channels", input: inputs.color, options: ["-seed", "17", "-random-threshold", "0x100%"], expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { name: "grayscale input control", input: inputs.gray, options: [], expected: "f7c6c0c504457bb02492225fb1e5dbc87e3de3c1083ebbdbf8adb3cac99e0c0b" },
    { name: "grayscale conversion control", input: inputs.color, options: ["-colorspace", "gray"], expected: "2d53d020663f9f29cd683ee4092d8fcf8d07995d66abaeb9f1a9d425f5b2a71a" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: seeded random threshold matches native $name`, async ({ input, options, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", original);
        const argv = ["/in.png", ...options, "PNG32:/out.png"];
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
