import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64"));
// Decoded RGBA hashes from ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const fixtures = [
    { ranges: ["20/80%", "20,80%", "20x80%", "20x80%+1+2"], hash: "0b8748783e85244c21259c816f5548d1733adf829081cb91879d0d44d5e650ef" },
    { ranges: ["x80%", "80%"], hash: "ee965af2d5ff9e2b2dbdfa741b03929995c9c276d3272a2731a65e22333a21ac" },
    { ranges: ["0x80%", "/80%", ",80%"], hash: "45626052f8b2a348b1a947a1412efe79b0ba361917420d70de0a6b12a37cdd66" },
    { ranges: ["20:80", "0.25"], hash: "25bccbfa4b3808a7c5e91ac2f35be880752eadc29003a1961b936474b8c59c6d" },
    { ranges: ["20x%", "20%"], hash: "381c08c5689cbb43987a1ef87be6549d79cf494c6b7c3c2cadacf89b768cb863" },
].flatMap(({ ranges, hash }) => ranges.map(range => ({ range, hash })));

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: parses random threshold $range`, async ({ range, hash }) => {
        const files = new Map([["/in.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", "-seed", "17", "-random-threshold", range, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([8, 6]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
