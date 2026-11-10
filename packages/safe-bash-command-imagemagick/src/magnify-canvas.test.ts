import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const input = Buffer.concat([Buffer.from("P6\n3 3\n255\n"), Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(i => colors[i]).join(""), "hex")]);
const cases = [
    { name: "2x page", options: ["-repage", "11x9-3+2", "-magnify"], expected: "6x6,22x18-6+4,DirectClass sRGB " },
    { name: "3x page", options: ["-repage", "11x9-3+2", "-define", "magnify:method=scale3x", "-magnify"], expected: "9x9,33x27-9+6,DirectClass sRGB " },
    { name: "unmagnified page", options: ["-repage", "11x9-3+2"], expected: "3x3,11x9-3+2,DirectClass sRGB " },
    { name: "default page", options: ["-magnify"], expected: "6x6,6x6+0+0,DirectClass sRGB " },
    { name: "RGB pixels", options: ["-repage", "11x9-3+2", "-magnify", "-depth", "8"], expected: undefined }
];

for (const mode of ["public", "buffered", "sync"] as const) {
    for (const { name, options, expected } of cases) {
        it(`${mode}: magnify preserves native ${name}`, async () => {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/im.ppm", input);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
            const args = ["/im.ppm", ...options, ...(expected === undefined ? ["rgb:/out"] : ["-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"])];
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
            if (expected === undefined) {
                expect(output.length).toBe(108);
                expect(createHash("sha256").update(output).digest("hex")).toBe("4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a");
            } else expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
