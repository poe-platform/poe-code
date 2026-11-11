import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"),
    Uint8Array.from({ length: 105 }, (_, i) => (13 * i + 9) % 256)]);

// Raw RGB output from ImageMagick 7.1.2-35 Q16-HDRI, including two-field controls.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const [option, geometries, length, hash] of [
    ["-wave", ["2:3", "2:3:4"], 126, "168b22e294e74713bc9d86e090813de5edf97398d5fc1a6d09c99c261c16d9dc"],
    ["-wave", ["2:5", "2x5:2", "2:5x3"], 105, "b0f2c8047ace2e9bbba4cc815c70edf92248e6b95e7e5271b3c51768ae3abf50"],
    ["-swirl", ["2:3", "2:3:4"], 105, "8746ce36788ab4f6aae6f87cd2ceece38513510e335212b20c9b31a800fdd52e"],
    ["-swirl", ["2:5", "2x5:2", "2:5x3"], 105, "c800ab6641ff6c2bd3de3bfbb7ad7662a601af33cee39d6db3e374819d3fe1e6"],
    ["-implode", ["2:3", "2:3:4"], 105, "262a138935bd1833caf16898aae5cb986a516c34b7bf499088ceae82d0c42b9b"],
    ["-implode", ["2:5", "2x5:2", "2:5x3"], 105, "353072778fadb63dd11bccd8c252a0ae7c4699cd8a82b19a0da853c7da5647aa"]
] as const) {
    it.each(geometries)(`${mode}: ${option} %s uses the first ratio pair`, async geometry => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", option, geometry, "-depth", "8", "rgb:/out"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : mode === "retained" ? await runConvertCli(argv, { filesystem, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
