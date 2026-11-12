import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
    for (const alpha of ["Discrete", "Deactivate"])
        it.each([
            { compose: "DstOver", frame: "1x1+0+0", hash: "ac8ef13a8dbab96fe0d8cf6459343f9ae70e483641821346c3bcee7ba465acbb" },
            { compose: "Multiply", frame: "1x1+0+0", hash: "93b5e57cc682128384c7a072de478cecbf0cfac9c1f8b82228936358b3605e6d" },
            { compose: "Multiply", frame: "2x2+1+1", hash: "8903fc8c434607206e90616e64f0b5fe876a9aca7ec65b102ee92a0c398b3f3d" },
            { compose: "Over", frame: "1x1+0+0", hash: "7d07882999e43123466164e0ed6d55549f377e92fed24abc7b9198b03b616e25" },
            { compose: "Copy", frame: "1x1+0+0", hash: "a7c2ff4c8dcec27d78f38d29b062e3003b655901ecbefa86ade5e1489029fcc4" },
        ])(`${mode}: keeps ${alpha} frame alpha inactive with $compose $frame`, async ({ compose, frame, hash }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["xc:#4080c080", "-alpha", alpha, "-colorspace", "sRGB", "-mattecolor", "#20402040",
                "-compose", compose, "-frame", frame, "-colorspace", "sRGB", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:out"];
            const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
        });
