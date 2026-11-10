import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = Uint8Array.from(Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64"));
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64"));

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["-cycle", "0", "/p.png"], exitCode: 1 },
        { args: ["-cycle", "1", "/a.ppm"], exitCode: 1 },
        { args: ["/a.ppm", "(", "-cycle", "1", ")"], exitCode: 1 },
        { args: ["/a.ppm", "-cycle", "0"], exitCode: 0 }
    ])(`${mode} checks the current image list for $args`, async ({ args, exitCode }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", ppm], ["/p.png", png], ["/out", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = [...args, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(result.exitCode).toBe(exitCode);
        expect(output).toEqual(exitCode ? original : Uint8Array.from(Buffer.from("f00a21ff34cc53ff2053eafffbcd20ff", "hex")));
        if (exitCode) expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-cycle'");
    });
}
