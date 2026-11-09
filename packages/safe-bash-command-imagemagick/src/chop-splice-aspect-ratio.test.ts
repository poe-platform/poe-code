import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick results for a 7x5 grid with red values 1 through 35.
const cases = [
    { operation: "-chop", geometry: "2:1+2+1", width: 2, height: 1, red: [1, 2] },
    { operation: "-chop", geometry: "1:2+2+1", width: 4, height: 1, red: [1, 2, 6, 7] },
    ...[
        { geometry: "2:1+2+1", sw: 7, sh: 4 },
        { geometry: "1:2+2+1", sw: 3, sh: 5 },
        { geometry: "2x1+2+1", sw: 2, sh: 1 },
    ].map(({ geometry, sw, sh }) => ({
        operation: "-splice", geometry, width: 7 + sw, height: 5 + sh,
        red: [
            1, 2, ...Array<number>(sw).fill(255), 3, 4, 5, 6, 7,
            ...Array<number>((7 + sw) * sh).fill(255),
            ...[8, 15, 22, 29].flatMap(start => [start, start + 1, ...Array<number>(sw).fill(255), start + 2, start + 3, start + 4, start + 5, start + 6]),
        ],
    })),
    { operation: "-chop", geometry: "2x1+2+1", width: 5, height: 4, red: [1, 2, 5, 6, 7, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30, 33, 34, 35] },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`resolves $geometry for $operation (${mode})`, async ({ operation, geometry, width, height, red }) => {
        const pixels = Uint8Array.from(Array.from({ length: 35 }, (_, i) => [i + 1, 0, 0, 255]).flat());
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", operation, geometry, "/out.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(red.flatMap(value => [value, value === 255 ? 255 : 0, value === 255 ? 255 : 0, 255])));
    });
}
