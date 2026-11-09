import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Both inputs have an isolated red seed at x=2. Native Q16 ImageMagick
// preserves every replacement sample when writing PNG64.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR4nGNw8Ej4D8L/GRjANAA91Qe0ftVsfAAAAABJRU5ErkJggg==", "base64");
const input16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAYAAACprNOOAAAAHUlEQVR4nGNwcPDwSEj4/9/BEUL//88ABEA+VBwA75UPaB4Aq34AAAAASUVORK5CYII=", "base64");

for (const bytes of [input, input16]) {
    const decoded = decodeImage(bytes);
    const source = decoded.data16 ? [...decoded.data16] : Array.from(decoded.data, value => value * 257);
    for (const mode of ["command", "retained", "buffered", "sync"] as const) {
        it.each([
            { operation: ["-fill", "#123456789abc", "-floodfill", "+2+0", "red"], painted: [0x1234, 0x5678, 0x9abc, 65535] },
            { operation: ["-fill", "#123456789abc", "-draw", "color 2,0 floodfill"], painted: [0x1234, 0x5678, 0x9abc, 65535] },
            { operation: ["-fill", "#abcd1234ef019876", "-floodfill", "+2+0", "red"], painted: [0xabcd, 0x1234, 0xef01, 0x9876] },
            { operation: ["-fill", "#abcd1234ef019876", "-draw", "color 2,0 floodfill"], painted: [0xabcd, 0x1234, 0xef01, 0x9876] },
            { operation: ["-draw", "fill '#abcd1234ef019876' color 2,0 floodfill"], painted: [0xabcd, 0x1234, 0xef01, 0x9876] },
            { operation: ["-fill", "#abcd1234ef019876", "-draw", "alpha 2,0 floodfill"], painted: [65535, 0, 0, 0x9876] },
            { operation: ["-channel", "R", "-fill", "#abcd1234ef019876", "-floodfill", "+2+0", "red", "+channel"], painted: [0xabcd, 0, 0, 65535] },
            { operation: ["-fill", "#123456789abc", "-floodfill", "+2+0", "blue"], painted: source.slice(8, 12) }
        ])(`${mode}: preserves replacement precision on ${decoded.data16 ? 16 : 8}-bit input ($operation)`, async ({ operation, painted }) => {
            const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const argv = ["in.png", ...operation, "PNG64:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data16!]).toEqual([...source.slice(0, 8), ...painted, ...source.slice(12)]);
        });
    }
}
