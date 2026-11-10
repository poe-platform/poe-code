import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 after clearing the region.
for (const mode of ["command", "retained", "buffered", "sync"] as const) for (const depth of [8, 16]) {
    for (const [operation, control] of [["-sample", "00070e2a3138a8afb6d2d9e0"], ["-scale", "272e3551585f979ea5c1c8cf"]] as const) {
        it.each([
            { name: "active region", before: ["-region", "2x1+1+0"], geometry: "2x2!", expected: "00".repeat(12) },
            { name: "unmasked control", before: [], geometry: "2x2!", expected: control },
            { name: "cleared region", before: ["-region", "2x1+1+0", "+region"], geometry: "2x2!", expected: control },
            { name: "unchanged dimensions", before: ["-region", "2x1+1+0"], geometry: "4x3!", expected: input.subarray(input.length - 36).toString("hex") },
        ])(`${mode}, depth=${depth}: ${operation} respects $name`, async ({ before, geometry, expected }) => {
            const source = depth === 8 ? input : Buffer.concat([Buffer.from("P6\n4 3\n65535\n"), Buffer.from(Array.from(input.subarray(input.length - 36)).flatMap(value => [value, value]))]);
            const files = new Map([["/in.ppm", source], ["/out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/in.ppm", ...before, operation, geometry, "+region", "-depth", "8", "rgb:/out"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ ...result, ...("stderr" in result ? {} : { stdout, stderr }) }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
