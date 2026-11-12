import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#257bd680 -modulate VALUE -depth 8 rgba:dest.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["+120,75,133", "975fce80"],
        ["+0x78,75,133", "975fce80"],
        ["120,75,133", "975fce80"],
        ["120", "4d95e080"],
        ["0x78,75,133", "00000080"],
    ])(`reads modulation components after signed brightness %s via ${mode}`, async (value, hex) => {
        const files = new Map<string, Uint8Array>([["/dest", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/dest", files.get("/dest")!);
        const args = ["xc:#257bd680", "-modulate", value, "-depth", "8", "rgba:/dest"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/dest")! : await filesystem.readFile("/dest");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
