import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const decoration of ["border", "frame"] as const) {
        it.each(["active region", "cleared region", "no region"] as const)(`${decoration} matches native RGB8 pixels with %s (${mode})`, async selection => {
            const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/in.ppm", ...(selection === "no region" ? [] : ["-region", "2x1+1+0"]),
                `-${decoration}`, "1x1", ...(selection === "cleared region" ? ["+region"] : ["-channel", "R", "-negate", "+channel", "+region"]), "-depth", "8", "rgb:/out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            // Native ImageMagick 7.1.2-35 clears the region on decoration.
            // The 4x3 source sits inside a one-pixel gray border/frame.
            const expected = Buffer.alloc(6 * 5 * 3, decoration === "border" ? 223 : 189);
            for (let y = 0; y < 3; y++) expected.set(input.subarray(input.length - 36 + y * 12, input.length - 36 + (y + 1) * 12), ((y + 1) * 6 + 1) * 3);
            if (selection !== "cleared region") for (let i = 0; i < expected.length; i += 3) expected[i] = 255 - expected[i]!;
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected.toString("hex"));
        });
    }
}
