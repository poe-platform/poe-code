import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const depth of [8, 16]) {
        const translucent = depth === 8 ? "#3070b080" : "#30307070b0b08080";
        const opaque = depth === 8 ? "#3070b0ff" : "#30307070b0b0ffff";
        it.each([
            ...[["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]].flatMap(operation => [
                { colors: [translucent], compose: "Difference", operation, hex: "1838587f" },
                { colors: [opaque], compose: "Difference", operation, hex: "10108000" }
            ]),
            { colors: ["#206030", opaque], compose: "Difference", operation: ["-composite"], hex: "101080ff" },
            { colors: [translucent], compose: "Over", operation: ["-flatten"], hex: "286870ff" }
        ])(`${mode} ${depth}-bit: $compose $operation $colors matches native pixels`, async ({ colors, compose, operation, hex }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = [...colors.map(color => `xc:${color}`), "-background", "#206030", "-compose", compose,
                ...operation, "-depth", "8", "rgba:/out"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}
