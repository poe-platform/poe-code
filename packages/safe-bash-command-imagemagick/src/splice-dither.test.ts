import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

// Native FX samples from a 40x40 image with R=x and G=y, across the full cycle.
it.each([
    [-8, 0], [-7, 9], [-6, 0], [-5, 23], [-4, 0], [-3, 16], [-2, 0], [-1, 30],
    [40, 8], [41, 39], [42, 22], [43, 39], [44, 15], [45, 39], [46, 29], [47, 39],
])("dithers both axes when coordinate %i is outside the image", (coordinate, sample) => {
    expect(virtualPixelIndex(coordinate!, 17, 40, 40, "dither")).toBe(33 * 40 + sample!);
    expect(virtualPixelIndex(17, coordinate!, 40, 40, "dither")).toBe(sample! * 40 + 33);
});

it("preserves in-bounds pixels with Dither", () => {
    expect(virtualPixelIndex(17, 17, 40, 40, "dither")).toBe(17 * 40 + 17);
});

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output from the 4x3 PPM below.
for (const mode of ["buffered", "retained", "sync", "command"]) {
    it.each([
        { method: "Dither", hash: "75400d94dcd752f71ba9a19458ab109f4f86a5553ca5ad2d0dfa15a50cea9b6a", right: "091623ff" },
        { method: "Edge", hash: "491964ff13c2207d81f5bfe38ab71bbdae0f5761f2c79e9f1634268d7e7b0c63", right: "7e8b98ff" },
    ])(`${mode}: splice matches native $method virtual pixels`, async ({ method, hash, right }) => {
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (13 * i + 9) % 256))]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-seed", "123", "-background", "#cc1177", "-virtual-pixel", method, "-splice", "2x2-2-2", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = Buffer.from(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
        expect(bytes).toHaveLength(6 * 5 * 4);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
        expect(bytes.subarray(0, 4).toString("hex")).toBe("091623ff");
        expect(bytes.subarray(4 * 4, 5 * 4).toString("hex")).toBe(right);
    });
}
