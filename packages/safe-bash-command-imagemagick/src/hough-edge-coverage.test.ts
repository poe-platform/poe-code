import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a white horizontal edge on a 9x7 black canvas.
const nativeGray = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [99, 51, 14, 0, 0, 0, 0, 14, 51],
    [245, 255, 255, 255, 223, 210, 212, 218, 220],
    [221, 220, 218, 212, 210, 223, 255, 255, 255],
    [100, 51, 14, 0, 0, 0, 0, 14, 51],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
].flat();

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["lines", "accumulator", "blank"] as const)(`${mode}: matches native horizontal Hough %s`, async output => {
        const input = new Uint8Array([
            ...new TextEncoder().encode("P6\n9 7\n255\n"),
            ...Array.from({ length: 9 * 7 * 3 }, (_, i) => Math.floor(i / 27) === 3 ? 255 : 0),
        ]);
        const fs = new MemoryFileSystem(), files = new Map([["line.ppm", input]]);
        await fs.writeFile("/line.ppm", input);
        const argv = ["line.ppm", "-background", "black", "-stroke", "white",
            ...(output === "accumulator" ? ["-define", "hough-lines:accumulator=true"] : []),
            "-hough-lines", output === "blank" ? "3x3+50" : "3x3+6",
            ...(output === "accumulator" ? ["-delete", "0"] : []), "-depth", "8", "rgba:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        if (output === "accumulator") {
            expect(pixels).toHaveLength(8640);
            expect(createHash("sha256").update(pixels).digest("hex")).toBe("4772ab7310d047575f2cbd500eb79bedadff202fbe7e90b99aa8e3dca2648df9");
        } else {
            expect([...pixels]).toEqual(nativeGray.flatMap(gray => [...Array<number>(3).fill(output === "blank" ? 0 : gray), 255]));
        }
    });
}
