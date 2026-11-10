import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const cases = [
    { seed: "9007199254740992", expected: "656aed29abc24f9fe45785073e3e6c647ceb97a5fbf5b120d355db9605d44a8f" },
    { seed: "9007199254740993", expected: "581f6c5f41b274e3e0aaa3fa0925d18422d09035589e2b6326df213b6e7e30f3" },
    { seed: "-2", expected: "d175b8543d06e6e78e1882a11a6f0ce8db49b5590fc6258a6577516ea6452fd3" },
    { seed: "18446744073709551614", expected: "d175b8543d06e6e78e1882a11a6f0ce8db49b5590fc6258a6577516ea6452fd3" },
    { seed: "17", expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves native integer seed $seed`, async ({ seed, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", original);
        const argv = ["/in.png", "-seed", seed, "-random-threshold", "0x100%", "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 6]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
    });

    it.each(["NaN", "Infinity", "not-a-seed"])(`${mode}: invalid seed %s preserves the destination`, async seed => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", original);
        const argv = ["/in.png", "-seed", seed, "-random-threshold", "0x100%", "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}
