import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI selects different rows for sample and Point.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { name: "sample extra channel", operation: ["-sample", "2x1!"], channel: "10", expected: "1133", size: "2x1" },
            { name: "Point extra channel", operation: ["-filter", "point", "-resize", "2x1!"], channel: "10", expected: "4466", size: "2x1" },
            { name: "sample red control", operation: ["-sample", "2x1!"], channel: "R", expected: "1133", size: "2x1" },
            { name: "Point red control", operation: ["-filter", "point", "-resize", "2x1!"], channel: "R", expected: "4466", size: "2x1" },
            { name: "sample unchanged size", operation: ["-sample", "3x2!"], channel: "10", expected: "112233445566", size: "3x2" },
            { name: "Point unchanged size", operation: ["-filter", "point", "-resize", "3x2!"], channel: "10", expected: "112233445566", size: "3x2" },
        ])(`${mode}, depth ${depth}: $name`, async ({ operation, channel, expected, size }) => {
            const input = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66].flatMap(value =>
                [value, value, value, 255].flatMap(component => depth === 8 ? [component] : [component, component === 255 ? 255 : component + 1])));
            for (const format of ["gray", "info"]) {
                const original = new TextEncoder().encode("KEEP");
                const files = new Map([["/in.raw", input], ["/out", original]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.raw", input);
                await fs.writeFile("/out", original);
                const inputs = channel === "R" ? ["rgba:/in.raw"]
                    : ["rgba:/in.raw", "rgba:/in.raw", "rgba:/in.raw", "xc:white", "rgba:/in.raw", "-combine"];
                const args = ["-size", "3x2", "-depth", String(depth), "-endian", "MSB", ...inputs, ...operation,
                    "-channel", channel, "-separate", "+channel", "-depth", String(depth), "-endian", "MSB",
                    "-format", "%wx%h", `${format}:/out`];
                const argumentValues = createCommandArguments(args);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    signal: new AbortController().signal,
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(output).toString(format === "info" ? "utf8" : "hex"))
                    .toBe(format === "info" ? size : depth === 8 ? expected : Buffer.from([...Buffer.from(expected, "hex")].flatMap(value => [value, value + 1])).toString("hex"));
            }
        });
    }
}
