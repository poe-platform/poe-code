import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
const cases = [
    { name: "omitted seed", options: [], random: true },
    { name: "seed -1", options: ["-seed", "-1"], random: true },
    { name: "seed 0", options: ["-seed", "0"], random: false, expected: "ff852b28e46c07196ce6a6fcb1fa9b1653ff660461ba46ea2c6bda5f9717ade1" },
    { name: "seed 17", options: ["-seed", "17"], random: false, expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { name: "seed -2", options: ["-seed", "-2"], random: false, expected: "d175b8543d06e6e78e1882a11a6f0ce8db49b5590fc6258a6577516ea6452fd3" },
    { name: "seed -1 overrides seed 0", options: ["-seed", "0", "-seed", "-1"], random: true },
    { name: "seed 0 overrides seed -1", options: ["-seed", "-1", "-seed", "0"], random: false, expected: "ff852b28e46c07196ce6a6fcb1fa9b1653ff660461ba46ea2c6bda5f9717ade1" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: random threshold $name`, async ({ options, random, expected }) => {
        const hashes = new Set<string>();
        for (let run = 0; run < (random ? 8 : 4); run++) {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            await fs.writeFile("/out.png", original);
            const argv = ["/in.png", ...options, "-random-threshold", "0x100%", "PNG32:/out.png"];
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
            const hash = createHash("sha256").update(output.data).digest("hex");
            if (expected) expect(hash).toBe(expected);
            hashes.add(hash);
        }
        if (random) expect(hashes.size).toBeGreaterThan(1);
        else expect(hashes.size).toBe(1);
    });
}
