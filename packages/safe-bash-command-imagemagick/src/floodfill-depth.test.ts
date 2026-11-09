import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI changes only the isolated red pixel at x=2.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAYAAACprNOOAAAAHUlEQVR4nGNwcPDwSEj4/9/BEUL//88ABEA+VBwA75UPaB4Aq34AAAAASUVORK5CYII=", "base64");
const source = [...decodeImage(input).data16!];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const outputName of ["out.png", "PNG64:out.png"]) {
        it.each([
            { operation: [], painted: source.slice(8, 12) },
            { operation: ["-fill", "lime", "-draw", "color 2,0 floodfill"], painted: [0, 65535, 0, 65535] },
            { operation: ["-fill", "lime", "-floodfill", "+2+0", "red"], painted: [0, 65535, 0, 65535] },
            { operation: ["-fill", "#abcd1234ef019876", "-floodfill", "+2+0", "red"], painted: [0xabcd, 0x1234, 0xef01, 0x9876] },
            { operation: ["-fill", "#11447780", "-draw", "alpha 2,0 floodfill"], painted: [65535, 0, 0, 0x8080] },
            { operation: ["-channel", "R", "-fill", "#abcd1234ef019876", "-floodfill", "+2+0", "red", "+channel"], painted: [0xabcd, 0, 0, 65535] },
            { operation: ["-fuzz", "1%", "-fill", "lime", "+floodfill", "+2+0", "#404048486060ffff"], painted: [0, 65535, 0, 65535] },
            { operation: ["-fuzz", "1%", "-fill", "lime", "-bordercolor", "#404048486060ffff", "-draw", "color 2,0 filltoborder"], painted: [0, 65535, 0, 65535] },
            { operation: ["-fill", "lime", "-floodfill", "+2+0", "blue"], painted: source.slice(8, 12) }
        ])(`${mode}: preserves edited and untouched 16-bit samples in ${outputName} ($operation)`, async ({ operation, painted }) => {
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", ...operation, outputName];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(source.slice(8, 12)).toEqual([65535, 0, 0, 65535]);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(output[24]).toBe(16);
            expect([...decodeImage(output).data16!]).toEqual([...source.slice(0, 8), ...painted, ...source.slice(12)]);
        });
    }
}
