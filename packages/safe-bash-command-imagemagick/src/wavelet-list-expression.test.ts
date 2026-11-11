import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n8 8\n255\n"),
    Uint8Array.from({ length: 192 }, (_, i) => (37 * i + 13) % 256),
]);
// ImageMagick 7.1.2-35 Q16-HDRI, two 8x8 frames emitted as RGB8.
const thousand = "4b52497d962bed3b2020a04977464dbb5e9d37e327805385189bb3d8e85db102";
const twoThousand = "c7c23e2dd46aee9ba50418486c83547ce019a0cee558c0170b5bc4e4ebb0ab26";
const perFrame = "e07f64d299d86b56fc4479f6461bea812dadebdd7d84b8c006298c7a6b6d7439";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { threshold: "1000", hash: thousand },
    { threshold: "2000", hash: twoThousand },
    { threshold: "%[fx:1000*n]", hash: twoThousand },
    { threshold: "%[fx:1000*(t+1)]", hash: perFrame },
    { threshold: "%[fx:250*u[1].w]", hash: twoThousand },
    { threshold: "%[fx:250*w]", hash: twoThousand },
])(`evaluates wavelet threshold $threshold against the full list (${mode})`, async ({ threshold, hash }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "-duplicate", "1", "-wavelet-denoise", threshold, "-depth", "8", "rgb:-"];
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(output).toHaveLength(384);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
