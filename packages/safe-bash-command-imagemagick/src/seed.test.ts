import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");

// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const cases = [
    { seed: "1", expected: "29bb1c7c0c4ca7a410c3e9567f75339741c52c98c7c11700f77f5ac277e4e399" },
    { seed: "1e1", expected: "29bb1c7c0c4ca7a410c3e9567f75339741c52c98c7c11700f77f5ac277e4e399" },
    { seed: "0", expected: "ff852b28e46c07196ce6a6fcb1fa9b1653ff660461ba46ea2c6bda5f9717ade1" },
    { seed: "0x11", expected: "ff852b28e46c07196ce6a6fcb1fa9b1653ff660461ba46ea2c6bda5f9717ade1" },
    { seed: "17", expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { seed: "17.5", expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { seed: "17x2", expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    ...["bad", "17bad", "0b10", "", "NaN", "Infinity"].map(seed => ({ seed, expected: undefined })),
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: parses -seed $seed without damaging existing output`, async ({ seed, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", "-seed", seed, "-random-threshold", "0x100%", "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (expected === undefined) {
            expect(result.exitCode).toBe(1);
            expect(bytes).toEqual(original);
        } else {
            expect(result.exitCode).toBe(0);
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([8, 6]);
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
        }
    });
}
