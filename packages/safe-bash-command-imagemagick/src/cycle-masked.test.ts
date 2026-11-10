import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAABHRSTlMowP+AOSYJWQAAAA1JREFUeJxjYGBkYgYAAA8AB4SOmW0AAAAASUVORK5CYII=", "base64");
const mask = Buffer.from("UDUKNCAxCjI1NQoA/wD/", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI: clipping blends colors but retains cycled indices.
    it.each([
        { options: ["-write-mask", "/mask.pgm", "-cycle", "1", "-cycle", "-1"], expected: "f00a21282a9f64c02053eaff664e0d80" },
        { options: ["-region", "2x1+1+0", "-cycle", "1", "-cycle", "-1"], expected: "0c06042834cc53c02053eaff664e0d80" },
        { options: ["-region", "2x1+1+0", "-cycle", "1", "+region", "-cycle", "-1"], expected: "f00a212834cc53c02053eafffbcd2080" },
        { options: ["-write-mask", "/mask.pgm", "-cycle", "1"], expected: "34cc53c02ca371c0fbcd20806d4e0e80" },
        { options: ["-cycle", "1", "-cycle", "-1"], expected: "f00a212834cc53c02053eafffbcd2080" }
    ])(`${mode} preserves translucent palette pixels for $options`, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>([["/t.png", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/t.png", ...options, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
