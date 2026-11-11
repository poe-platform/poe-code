import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, -depth 8 rgb:-.
const cases = [
    { name: "mask retained", operations: ["-write-mask", "/mask.pgm", "-blur", "1x1"], pixels: [0, 51, 255, 0, 0, 255, 0, 51, 255] },
    { name: "mask removed", operations: ["-write-mask", "/mask.pgm", "-blur", "1x1", "+write-mask"], pixels: [0, 51, 255, 0, 0, 255, 0, 51, 255] },
    { name: "unmasked", operations: ["-blur", "1x1"], pixels: [0, 71, 184, 0, 71, 184, 0, 71, 184] },
    { name: "Gaussian", operations: ["-write-mask", "/mask.pgm", "-gaussian-blur", "1x1"], pixels: [0, 70, 255, 0, 0, 255, 0, 70, 255] },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`clips each blur pass at protected pixels (${mode}, $name)`, async ({ operations, pixels }) => {
    const files = new Map([
        ["/input.ppm", Buffer.concat([Buffer.from("P6\n3 3\n255\n"), Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255].flatMap(value => [value, value, value]))])],
        ["/mask.pgm", Buffer.concat([Buffer.from("P5\n3 3\n255\n"), Buffer.from([255, 0, 255, 255, 255, 255, 255, 0, 255])])],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, data] of files) await filesystem.writeFile(path, data);
    const tokens = ["/input.ppm", ...operations, "-depth", "8", "rgb:/out.rgb"];
    if (mode === "command") {
        const args = createCommandArguments(tokens);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        const result = mode === "sync" ? runConvertCliSync(tokens, files)
            : await runConvertCli(tokens, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect([...output]).toEqual(pixels.flatMap(value => [value, value, value]));
});
