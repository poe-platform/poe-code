import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const method of ["Dilate", "Erode"] as const)
it(`honors morphology channel masks for ${method} (${mode})`, async () => {
    const pixels = [32, 96, 160, 64, 192, 64, 16, 192, 80, 112, 176, 128];
    const input = await sharp(new Uint8Array(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    for (const [channel, selected] of [["R", [0]], ["B", [2]], ["A", [3]], ["RG", [0, 1]], ["RGBA", [0, 1, 2, 3]], [undefined, [0, 1, 2, 3]]] as const) {
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", ...(channel ? ["-channel", channel] : []), "-morphology", method, "Rectangle:3x1", "+channel", "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const actual = [...decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png")).data];
        const expected = pixels.map((value, index) => {
            if (!selected.some(c => c === index % 4)) return value;
            const x = Math.floor(index / 4), c = index % 4;
            const neighbors = [-1, 0, 1].map(dx => pixels[Math.max(0, Math.min(2, x + dx)) * 4 + c]!);
            return method === "Dilate" ? Math.max(...neighbors) : Math.min(...neighbors);
        });
        expect(actual, channel ?? "unmasked").toEqual(expected);
        // Native ImageMagick reference samples from the reported RGB fixture.
        if (method === "Dilate" && channel === "R") expect(actual.slice(4, 7)).toEqual([192, 64, 16]);
        if (method === "Erode" && channel === "B") expect(actual.slice(0, 3)).toEqual([32, 96, 16]);
    }
});

it.each([false, true])("preserves unselected channels through compound morphology (retained=%s)", async retained => {
    const pixels = [32, 96, 160, 64, 192, 64, 16, 192, 80, 112, 176, 128];
    const input = await sharp(new Uint8Array(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    for (const method of ["Open", "Close", "EdgeIn", "EdgeOut", "Edge", "TopHat", "BottomHat"]) {
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        expect(await runConvertCli(["/in.png", "-channel", "R", "-morphology", method, "Rectangle:3x1", "+channel", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const actual = [...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data];
        expect(actual.filter((_, i) => i % 4 !== 0), method).toEqual(pixels.filter((_, i) => i % 4 !== 0));
    }
});
