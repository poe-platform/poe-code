import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with LQR, using the numbered 6x4 PPM.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const grouped of [false, true]) {
        it.each([
            { geometry: "2x2!", widths: [2, 2], height: 2, hash: "95bdda63305cf9654fc5447148a874415e0bf641b095c493335322fd5fb8060b" },
            { geometry: "%[fx:n]x2!", widths: [2, 2], height: 2, hash: "95bdda63305cf9654fc5447148a874415e0bf641b095c493335322fd5fb8060b" },
            { geometry: "%[fx:u[1].w/3]x2!", widths: [2, 2], height: 2, hash: "95bdda63305cf9654fc5447148a874415e0bf641b095c493335322fd5fb8060b" },
            { geometry: "%[fx:t+2]x2!", widths: [2, 3], height: 2, hash: "a90ab75bea4aae324ebf892a9223d4e21853b85d4560f1a63dbaa5d706d2c6c6" },
            { geometry: "%[fx:u[0].w/3]x2!", widths: [2, 1], height: 2, hash: "5a1678a9cdb9fe21acafd3d632567dcfd39d3898ba52ef49f267d9efbcbb06e0" },
            { geometry: "4x3!", widths: [4, 4], height: 3, hash: "39af8212ad1021239fc0d97cf013f19ecf6476ae4b96e5af5b849639f507a66d" },
            { geometry: "%[fx:n+2]x3!", widths: [4, 4], height: 3, hash: "39af8212ad1021239fc0d97cf013f19ecf6476ae4b96e5af5b849639f507a66d" },
        ])(`${mode}, grouped=${grouped}: liquid-rescale resolves $geometry against the current list`, async ({ geometry, widths, height, hash }) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P6\n6 4\n255\n"),
                ...Array.from({ length: 72 }, (_, index) => index),
            ]);
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argv = [...(grouped ? ["-size", "1x1", "xc:red", "("] : []),
                "/in.ppm", grouped ? "/in.ppm" : "+clone", "-liquid-rescale", geometry,
                ...(grouped ? [")", "-delete", "0"] : []),
                "-depth", "8", "-write", "rgb:/pixels", "-format", "%wx%h|%g\n", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
            expect(new TextDecoder().decode(output)).toBe(widths.map(width => `${width}x${height}|${width}x${height}+0+0\n`).join(""));
            expect(pixels).toHaveLength(widths.reduce((sum, width) => sum + width * height * 3, 0));
            expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
        });
    }
}
