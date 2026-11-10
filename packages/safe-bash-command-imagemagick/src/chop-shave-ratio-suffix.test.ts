import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, P6 4x3 input with RGB bytes i * 7.
const unchanged = "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff";
const cases = [
    ...["1x1/2", "1x1:0", "1x1:2", "1x1/2+1+1", "1x1+0+0/2"].map(geometry => ({ operation: "-chop", geometry, width: 4, height: 3, pixels: unchanged, warns: true })),
    ...["1x1/2", "1x1/0", "1x1/2+1+1", "1x1+0+0/2"].map(geometry => ({ operation: "-shave", geometry, width: 4, height: 3, pixels: unchanged, warns: true })),
    { operation: "-chop", geometry: "1x1", width: 3, height: 2, pixels: "697077ff7e858cff939aa1ffbdc4cbffd2d9e0ffe7eef5ff", warns: false },
    ...["1x1", "1x1:0", "1x1:2"].map(geometry => ({ operation: "-shave", geometry, width: 2, height: 1, pixels: "697077ff7e858cff", warns: false })),
    { operation: "", geometry: "", width: 4, height: 3, pixels: unchanged, warns: false },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`preserves native raster and warnings for $operation $geometry (${mode})`, async ({ operation, geometry, width, height, pixels, warns }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
        const files = new Map([["/input.ppm", input], ["/output.png", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/input.ppm", ...(operation ? [operation, geometry] : []), "PNG32:/output.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(pixels);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${operation === "-shave" ? "/input.ppm" : geometry}'\n` : "");
    });
}
