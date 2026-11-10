import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: bytes 1 through 35 in a 7x5 PGM.
const input = Buffer.concat([Buffer.from("P5\n7 5\n255\n"), Buffer.from(Array.from({ length: 35 }, (_, i) => i + 1))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["3x2+1+1!", 3, 2, 3, 2, 0, 0, [9, 10, 11, 16, 17, 18]],
        ["3x2-1-1!", 2, 1, 3, 2, 1, 1, [1, 2]],
        ["3x2+8+0!", 1, 1, 3, 2, -9, -1, [255]],
        ["3x2+1+1", 3, 2, 7, 5, 1, 1, [9, 10, 11, 16, 17, 18]],
    ] as const)(`uses the requested crop viewport for %s (${mode})`, async (geometry, width, height, pageWidth, pageHeight, x, y, samples) => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const missed = x === -9;
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(missed ? `magick: geometry does not contain image '${geometry}'\n` : "");
        const retained = mode === "retained" || mode === "command";
        const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
        expect(names.filter(name => name.startsWith("tile-"))).toEqual(["tile-00.png"]);
        const output = decodeImage(retained ? await filesystem.readFile("/tile-00.png") : files.get("/tile-00.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(samples.flatMap(value => [value, value, value, missed ? 0 : 255])));
        expect(output.virtualCanvas).toEqual({ width: pageWidth, height: pageHeight, x, y });
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`uses the bang viewport for a subsequent compare crop (${mode})`, async () => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        files.set("/expected.pgm", Buffer.from("P5\n1 1\n255\n\x09"));
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["compare", "(", "/input.pgm", "-crop", "3x2+1+1!", "-crop", "1x1+0+0", ")", "/expected.pgm", "/diff.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/diff.png") : files.get("/diff.png")!);
        expect([output.width, output.height]).toEqual([1, 1]);
    });
}
