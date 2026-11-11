import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n6 4\n255\n"),
    ...Array.from({ length: 72 }, (_, index) => index),
]);

const operation = "-posterize";
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const grouped of [false, true])
it.each([
    { geometry: "6", levels: [6, 6] },
    { geometry: "%[fx:n+4]", levels: [6, 6] },
    { geometry: "%[fx:u[1].w]", levels: [6, 6] },
    { geometry: "%[fx:t+5]", levels: [5, 6] },
])(`${mode}, ${operation}, grouped=${grouped}: evaluates $geometry against the current image list`, async ({ geometry, levels }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = [
        ...(grouped ? ["-size", "1x1", "xc:red", "("] : []),
        "/in.ppm", grouped ? "/in.ppm" : "+clone", operation, geometry,
        ...(grouped ? [")", "-delete", "0"] : []),
        "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/pixels",
    ];
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const pixels = mode === "command" ? new Uint8Array(Buffer.concat(chunks))
        : mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
    expect(pixels).toHaveLength(144);
    if (levels.every(level => level === 6)) {
        // ImageMagick 7.1.2-35 Q16-HDRI, including the literal 6 control.
        expect(createHash("sha256").update(pixels).digest("hex")).toBe("f4ec45f4dc3a66bdc0b5911cacfa6b795195a78a23e778b0f563d880f2aec4d9");
    }
    const controls = levels.flatMap(level => {
        const control = new Map([["/in.ppm", input]]);
        expect(runMagickCliSync([
            "/in.ppm", operation, `${level}`, "-depth", "8", "rgb:/pixels",
        ], control).exitCode).toBe(0);
        return Array.from(control.get("/pixels")!);
    });
    expect(pixels).toEqual(Uint8Array.from(controls));
});
