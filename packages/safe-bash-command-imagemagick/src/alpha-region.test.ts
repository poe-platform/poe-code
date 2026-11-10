import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI replaces alpha outside the rectangle.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { color: "#80402060", before: [], operation: "Opaque", region: true, hex: "804020ff80402060804020ff" },
            { color: "#804020ff", before: [], operation: "Transparent", region: true, hex: "80402000804020ff80402000" },
            { color: "#804020", before: ["-alpha", "Off"], operation: "Opaque", region: true, hex: "804020ff80402000804020ff" },
            { color: "#80402060", before: [], operation: "Opaque", region: false, hex: "804020ff804020ff804020ff" },
            { color: "#804020ff", before: [], operation: "Transparent", region: false, hex: "804020008040200080402000" },
            { color: "#80402060", before: [], operation: "Opaque", region: true, size: "4098x3", geometry: "2x1+4095+1", hex: "804020ff".repeat(8193) + "80402060".repeat(2) + "804020ff".repeat(4099) },
            { color: "#804020ff", before: [], operation: "Transparent", region: true, size: "4098x3", geometry: "2x1+4095+1", hex: "80402000".repeat(8193) + "804020ff".repeat(2) + "80402000".repeat(4099) },
        ])(`${mode}, ${depth}-bit: $operation with region=$region after $before at $geometry`, async ({ color, before, operation, region, hex, size = "3x1", geometry = "1x1+1+0" }) => {
            const files = new Map([["out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = ["-size", size, `xc:${color}`, ...before,
                ...(region ? ["-region", geometry] : []), "-alpha", operation,
                ...(region ? ["+region"] : []), "-depth", String(depth), "-endian", "MSB", "rgba:out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const expected = Buffer.from(hex, "hex");
            expect(Buffer.from(output)).toEqual(depth === 8 ? expected : Buffer.from([...expected].flatMap(value => [value, value])));
        });
    }
}
