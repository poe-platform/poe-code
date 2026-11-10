import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const input = Buffer.concat([Buffer.from("P6\n3 3\n255\n"), Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(i => colors[i]).join(""), "hex")]);
// RGB hashes from ImageMagick 7.1.2-35 Q16-HDRI.
const hashes = {
    6: "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a",
    9: "4cf18e7d0c46c169e7076e2a60e8b96b8091cf129ac107c3476dd6185a7ce9f9"
};
const cases: [string, string[], 6 | 9][] = [
    ["set option", ["-set", "option:magnify:method", "scale3x"], 9],
    ["clear option", ["-define", "magnify:method=scale3x", "+set", "option:magnify:method"], 6],
    ["define", ["-define", "magnify:method=scale3x"], 9],
    ["clear define", ["-define", "magnify:method=scale3x", "+define", "magnify:method"], 6],
    ["artifact", ["-set", "artifact:magnify:method", "scale3x"], 6]
];

for (const mode of ["public", "buffered", "sync"] as const) {
    for (const [name, settings, size] of cases) {
        for (const format of ["info", "rgb"] as const) {
            it(`${mode}: ${name} magnify matches native ${format}`, async () => {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/im.ppm", input);
                await fs.writeFile("/out", Buffer.from("KEEP"));
                const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
                const args = ["/im.ppm", ...settings, "-magnify", ...(format === "info" ? ["-format", "%wx%h,%Wx%H%X%Y,%r"] : ["-depth", "8"]), `${format}:/out`];
                const argumentValues = createCommandArguments(args);
                const context = {
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
                } as unknown as CommandContext;
                const result = mode === "public" ? await createMagickCommand().execute(context)
                    : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
                expect(result.exitCode).toBe(0);
                const output = mode === "public" ? await fs.readFile("/out") : files.get("/out")!;
                if (format === "info") expect(Buffer.from(output).toString()).toBe(`${size}x${size},${size}x${size}+0+0,DirectClass sRGB `);
                else {
                    expect(output.length).toBe(size * size * 3);
                    expect(createHash("sha256").update(output).digest("hex")).toBe(hashes[size]);
                }
            });
        }
    }
}
