import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it("reports the off-center rectangle's channel Hu moments through every identify entry point", async () => {
    const pixels = new Uint8Array(7 * 6 * 3);
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) pixels.fill(255, (y * 7 + x) * 3, (y * 7 + x) * 3 + 3);
    const bytes = await sharp(pixels, { raw: { width: 7, height: 6, channels: 3 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/shape.png", bytes);
    const args = ["-moments", "-verbose", "/shape.png"];
    const verify = (stdout: string) => {
        expect(stdout).toContain("  Channel Hu moments:\n");
        for (const name of ["Red", "Green", "Blue"]) expect(stdout).toContain(`    ${name}:\n      Centroid: 2.5,3\n      Ellipse Semi-Major/Minor axis: 2.23607,1.63299\n`);
        expect(stdout).toContain("      Ellipse eccentricity: 0.68313\n");
        expect(stdout).toContain("      Ellipse intensity: 266.749 (1.04607)\n");
        expect(stdout).toContain("      I1: 0.000626362 (0.159722)\n");
        expect(stdout).toContain("      I2: 3.63405e-08 (0.00236304)\n");
        expect(stdout).toContain("  Image moments:\n    Overall:\n");
    };
    verify(runIdentifyCliSync(args, new Map([["/shape.png", bytes]])).stdout);
    for (const input of [new Map([["/shape.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
        const result = await runIdentifyCli(args, input);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        verify(result.stdout);
        expect((await runIdentifyCli(["-verbose", "/shape.png"], input)).stdout).not.toContain("moments:");
        expect((await runIdentifyCli(["-moments", "+moments", "-verbose", "/shape.png"], input)).stdout).not.toContain("moments:");
        expect((await runIdentifyCli(["-moments", "-verbose", "-precision", "3", "/shape.png"], input)).stdout).toContain("Ellipse Semi-Major/Minor axis: 2.24,1.63");
        expect((await runIdentifyCli(["-moments", "-format", "%w", "/shape.png"], input)).stdout).toBe("7");
    }
    const argumentValues = createCommandArguments(["identify", ...args]);
    let stdout = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    verify(stdout);
    expect(await fs.readFile("/shape.png")).toEqual(bytes);
});

// Native ImageMagick 7.1.2 Q16-HDRI; asymmetric colors exercise all eight invariants.
import fixtures from "./identify-moments-fixtures.json" with { type: "json" };
it.each(fixtures)("matches native channel and overall measurements at $depth bits", async ({ png, moments }) => {
    const bytes = Buffer.from(png, "base64"), fs = new MemoryFileSystem();
    await fs.writeFile("/colors.png", bytes);
    for (const input of [new Map([["/colors.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
        const result = await runIdentifyCli(["-moments", "-verbose", "/colors.png"], input);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.split("  Channel Hu moments:\n")[1]?.trim()).toBe(moments.trim());
    }
});
