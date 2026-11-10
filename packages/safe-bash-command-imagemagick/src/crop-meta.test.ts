import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples, in row order.
const input = Uint8Array.from([17, 34, 51, 68, 85, 102].flatMap(value => [value, value, value, 255]));
const combined = ["rgba:in.raw", "rgba:in.raw", "rgba:in.raw", "xc:white", "rgba:in.raw", "-combine"];
const operations = [
    { operation: "-crop", geometry: "2x1+1+1", pixels: "5566", dimensions: "2x1" },
    { operation: "-chop", geometry: "1x1+1+0", pixels: "4466", dimensions: "2x1" },
    { operation: "-shave", geometry: "1x0", pixels: "2255", dimensions: "1x2" },
    { operation: "-crop", geometry: "3x2+0+0", pixels: "112233445566", dimensions: "3x2" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const channel of ["10", "R", "main"] as const) for (const format of ["gray", "info"] as const) {
        it.each(operations)(`${mode}: ${channel} channel ${format} $operation $geometry`, async ({ operation, geometry, pixels, dimensions }) => {
            const files = new Map([["in.raw", input], ["out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["-size", "3x2", "-depth", "8", ...(channel === "R" ? ["rgba:in.raw"] : combined),
                operation, geometry, ...(channel === "main" ? [] : ["-channel", channel, "-separate", "+channel"]),
                "-format", "%wx%h", "-depth", "8", `${format}:out`];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString(format === "gray" ? "hex" : "utf8")).toBe(format === "gray" ? pixels : dimensions);
        });
    }
}
