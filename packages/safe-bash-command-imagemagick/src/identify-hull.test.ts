import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCliSync } from "./index.js";

it.each([false, true])("reports foreground hull and minimum rotated box (diamond=%s)", async diamond => {
    const pixels = new Uint8Array(7 * 6 * 3);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 7; x++) {
        if (diamond ? Math.abs(x - 3) + Math.abs(y - 3) <= 2 : x >= 1 && x <= 4 && y >= 2 && y <= 4)
            pixels.fill(255, (y * 7 + x) * 3, (y * 7 + x) * 3 + 3);
    }
    const bytes = await sharp(pixels, { raw: { width: 7, height: 6, channels: 3 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/shape.png", bytes);
    const args = ["-define", "identify:convex-hull=true", "-verbose", "/shape.png"];
    const verify = (result: { exitCode: number; stdout: string; stderr: string }) => {
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(diamond ? "  Convex hull: 3,1 5,3 3,5 1,3 3,1 \n  Minimum bounding box: 5,3 3,5 1,3 3,1 \n" : "  Convex hull: 1,2 4,2 4,4 1,4 1,2 \n  Minimum bounding box: 4,2 4,4 1,4 1,2 \n");
    };
    verify(runIdentifyCliSync(args, new Map([["/shape.png", bytes]])));
    const argumentValues = createCommandArguments(["identify", ...args]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
        fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    verify({ ...result, stdout, stderr });
    for (const options of [[], ["-define", "identify:convex-hull=false"], ["-define", "identify:convex-hull", "+define", "identify:convex-hull"]]) {
        const plain = runIdentifyCliSync([...options, "-verbose", "/shape.png"], new Map([["/shape.png", bytes]]));
        expect(plain.exitCode).toBe(0);
        expect(plain.stdout).not.toContain("Convex hull:");
    }
});
