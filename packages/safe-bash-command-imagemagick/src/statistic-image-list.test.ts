import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n6 4\n255\n"),
    ...Array.from({ length: 72 }, (_, index) => index),
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const grouped of [false, true])
it.each([
    { geometry: "2x1", widths: [2, 2] },
    { geometry: "%[fx:n]x1", widths: [2, 2] },
    { geometry: "%[fx:u[1].w/3]x1", widths: [2, 2] },
    { geometry: "%[fx:u[0].w/3]x1", widths: [2, 2] },
    { geometry: "%[fx:t+1]x1", widths: [1, 2] },
])(`${mode}, grouped=${grouped}: evaluates statistic window $geometry against the current image list`, async ({ geometry, widths }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = [
        ...(grouped ? ["-size", "1x1", "xc:red", "("] : []),
        "/in.ppm", grouped ? "/in.ppm" : "+clone", "-statistic", "Mean", geometry,
        ...(grouped ? [")", "-delete", "0"] : []),
        "-depth", "8", "rgb:-",
    ];
    const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const pixels = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(pixels).toHaveLength(144);
    if (widths.every(width => width === 2)) {
        // ImageMagick 7.1.2-35 Q16-HDRI, including the literal 2x1 control.
        expect(createHash("sha256").update(pixels).digest("hex")).toBe("b077e604091bc54097384c59c2cea44493b702c3e4f868f4f08dbfedaef2afa5");
    } else {
        const controls = widths.flatMap(width => {
            const control = runMagickCliSync([
                "/in.ppm", "-statistic", "Mean", `${width}x1`, "-depth", "8", "rgb:-",
            ], new Map([["/in.ppm", input]]));
            expect(control.exitCode).toBe(0);
            return Array.from(control.stdoutBytes!);
        });
        expect(Array.from(pixels)).toEqual(controls);
    }
});
