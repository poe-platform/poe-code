import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, macOS arm64, without OpenMP.
// Each reference was identical across five fresh native processes.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: "-resize", removal: "before", negate: false, expected: "121f2c4a57648794a1bfccd9" },
        { operation: "-resize", removal: "after", negate: false, expected: "a3b0bdcad7e4a3b0bdcad7e4" },
        { operation: "-resize", removal: "after", negate: true, expected: "5c4f4235281b5c4f4235281b" },
        { operation: "-sample", removal: "after", negate: true, expected: "ffffffffffffffffffffffff" },
        { operation: "-scale", removal: "after", negate: true, expected: "ffffffffffffffffffffffff" },
    ])(`resizes with a smaller write mask: $operation removal=$removal negate=$negate (${mode})`, async ({ operation, removal, negate, expected }) => {
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 13 + 7) % 256))]);
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", "-write-mask", "xc:black", ...(removal === "before" ? ["+write-mask"] : []), operation, "2x2!", ...(negate ? ["-negate"] : []), ...(removal === "after" ? ["+write-mask"] : []), "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
