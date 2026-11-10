import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 RGBA8 output for the same 4x3 PPM.
const cases = [
    { operation: "-chop", geometry: "1x1+1+1", extra: "+2", width: 3, height: 2,
        pixels: "00070eff2a3138ff3f464dffa8afb6ffd2d9e0ffe7eef5ff" },
    { operation: "-shave", geometry: "1x1", extra: "+0+0+1", width: 2, height: 1,
        pixels: "697077ff7e858cff" },
    { operation: "-splice", geometry: "1x1+1+1", extra: "+2", width: 5, height: 4,
        pixels: "00070eff123456ff151c23ff2a3138ff3f464dff123456ff123456ff123456ff123456ff123456ff545b62ff123456ff697077ff7e858cff939aa1ffa8afb6ff123456ffbdc4cbffd2d9e0ffe7eef5ff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const extraOffset of [false, true]) {
        it.each(cases)(`${mode}: $operation preserves rectangle pixels (extra offset: ${extraOffset})`, async ({ operation, geometry, extra, width, height, pixels }) => {
            const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.ppm", input], ["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            await fs.writeFile("/out", keep);
            const argv = ["/in.ppm", "-background", "#123456", operation, geometry + (extraOffset ? extra : ""), "PNG32:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(Buffer.from(output.data).toString("hex")).toBe(pixels);
        });
    }
}
