import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n2 2\n65535\n"),
    Buffer.from("123456789abcdef013572468101121223132414251526162", "hex")
]);

// Exact native ImageMagick 7.1.2-35 Q16-HDRI bytes; unequal sample bytes expose swaps.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.raw"] as const) {
        it.each([
            { depth: "16", endian: "MSB", coder: "rgb", hex: "123456789abcdef013572468101121223132414251526162" },
            { depth: "16", endian: "LSB", coder: "rgb", hex: "34127856bc9af0de57136824111022213231424152516261" },
            { depth: "16", endian: "MSB", coder: "rgba", hex: "123456789abcffffdef013572468ffff101121223132ffff414251526162ffff" },
            { depth: "16", endian: "LSB", coder: "rgba", hex: "34127856bc9afffff0de57136824ffff111022213231ffff424152516261ffff" },
            { depth: "8", endian: "MSB", coder: "rgb", hex: "12569ade1324102131415161" }
        ])(`${mode} ${destination}: writes $depth-bit $coder in $endian byte order`, async ({ depth, endian, coder, hex }) => {
            const args = ["/in.ppm", "-tile", "1x", "-geometry", "+0+0", "-depth", depth, "-endian", endian, `${coder}:${destination}`];
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input]]);
            let output: Uint8Array;
            if (mode === "magick" || mode === "montage") {
                const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
                const chunks: Uint8Array[] = [], stderr: Uint8Array[] = [];
                const context: CommandContext = {
                    command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr.push(chunk.slice()); } }, registerCleanup() {}
                };
                const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context);
                expect(stderr).toEqual([]);
                expect(result.exitCode).toBe(0);
                output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
            } else {
                const result = mode === "sync" ? runMontageCliSync(args, files)
                    : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                output = destination === "-" ? result.stdoutBytes!
                    : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
            }
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}

it("preserves MSB byte order when adjoining raw montage pages in a file", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const result = await runMontageCli([
        "/in.ppm", "/in.ppm", "-tile", "1x1", "-geometry", "+0+0",
        "-depth", "16", "-endian", "MSB", "rgb:/sheet.raw"
    ], { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Buffer.from(await fs.readFile("/sheet.raw")).toString("hex"))
        .toBe("123456789abcdef013572468101121223132414251526162".repeat(2));
});
