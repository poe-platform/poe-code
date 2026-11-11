import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA hashes.
const cases = [
    { options: ["-seed", "17", "-spread", "2"], hash: "0c7c6510e739ae4f302963bb60c6992e5a4cab6263ecb791afd1c4b069e67de6" },
    { options: ["-seed", "2", "-spread", "2"], hash: "53257ad7e815ee24ca3537e9f3dffbf2884eea10b5605122758cab8609ac42cb" },
    { options: ["-seed", "17", "-spread", "1"], hash: "84ed1f2365f5bb3c6fde9c8e25bb62b8ae5c840464e197a04be90f2fd76fb82c" },
    { options: ["-seed", "17", "-spread", "0"], hash: "0c7c6510e739ae4f302963bb60c6992e5a4cab6263ecb791afd1c4b069e67de6" },
    { options: [], hash: "f5c93b02a98e0d797e63e705e6e8cdf4fc077c7ab15eafa7e7d5c12db6f80efa" },
    { options: ["-seed", "17", "-random-threshold", "0x100%"], hash: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" }
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native $options`, async ({ options, hash }) => {
        const keep = Buffer.from("KEEP"), files = new Map([["/in.png", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const argv = ["/in.png", ...options, "PNG32:/out.png"], args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 6]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}

for (const mode of ["retained", "sync"] as const) {
    it.each(["", "bad", "NaN", "Infinity", "1e100", "1e100:0"])(`${mode}: rejects invalid spread radius %s without replacing output`, async radius => {
        const keep = Buffer.from("KEEP"), files = new Map([["/in.png", input], ["/out.png", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        await filesystem.writeFile("/out.png", keep);
        const argv = ["/in.png", "-spread", radius, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, { filesystem, cwd: "/" });
        expect(result.exitCode).not.toBe(0);
        expect(Array.from(mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png"))).toEqual(Array.from(keep));
    });
}
