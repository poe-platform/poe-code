import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGB8 hashes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { width: 5, height: 5, seed: "3", method: "random", hash: "d85861be86ea66ce5e12b7deca84b219612940132140ce0d1f660ade078eebf3" },
        { width: 5, height: 5, seed: "4", method: "random", hash: "db09099efa1d0d7f8c746de816dab78ba56d79a12df19ed1c6d4cbe6ac279683" },
        { width: 5, height: 5, seed: "3", method: "edge", hash: "d70c4913bb6a13bcbdc12255ce09c2e9c6c5ef1a21577abeb5556bb453afca40" },
        { width: 513, height: 3, seed: "3", method: "random", hash: "f18941ee7c1855e0010e62a36944c3db64d12c14d6ac706d0f9ac1721bc4c674" },
        { width: 1, height: 1, seed: "3", method: "random", hash: "b6edfea0b85401319c557c07003e49df41dc8b241c21ef3458986b21782bef4c" },
    ])(`${mode}: enhance $width x $height seed=$seed with $method virtual pixels`, async ({ width, height, seed, method, hash }) => {
        const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(
            Array.from({ length: width * height }, (_, i) => [111 + 2 * (i % 7), 103 + 4 * (i % 3), 125 + 2 * (i % 5)]).flat()
        )]);
        for (let repeat = 0; repeat < 3; repeat++) {
            const argv = ["/in.ppm", "-colorspace", "sRGB", "-seed", seed, "-background", "#765494",
                "-virtual-pixel", method, "-enhance", "-colorspace", "sRGB", "-depth", "8",
                mode === "command" ? "rgb:-" : "rgb:/out"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            await fs.writeFile("/in.ppm", input);
            const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const pixels = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
        }
    });
}
