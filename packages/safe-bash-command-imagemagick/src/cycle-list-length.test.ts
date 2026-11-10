import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // Exact RGBA output from ImageMagick 7.1.2-35 Q16-HDRI.
    it.each([
        { count: 2, amount: "%[fx:n]", expected: "2053eafffbcd20fff00a21ff34cc53ff2053eafffbcd20fff00a21ff34cc53ff" },
        { count: 2, amount: "2", expected: "2053eafffbcd20fff00a21ff34cc53ff2053eafffbcd20fff00a21ff34cc53ff" },
        { count: 1, amount: "%[fx:n]", expected: "34cc53ff2053eafffbcd20fff00a21ff" }
    ])(`${mode} cycles $count images by $amount using the full list length`, async ({ count, amount, expected }) => {
        const files = new Map<string, Uint8Array>([["/p.png", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = [...Array<string>(count).fill("/p.png"), "-cycle", amount, ...(count > 1 ? ["+append"] : []), "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
