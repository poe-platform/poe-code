import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["50", [0, 254, 0, 191, 127, 55, 205, 63]],
        ["50%", [0, 1, 0, 64, 127, 55, 50, 63]],
        ["50%x1", [0, 1, 0, 64, 127, 55, 50, 63]],
        ["50x1%", [0, 254, 0, 191, 127, 55, 205, 63]],
        ["50% ", [0, 1, 0, 64, 127, 55, 50, 63]],
        ["0x32%x1", [0, 1, 0, 64, 127, 55, 50, 63]],
        ["0x32x1%", [0, 254, 0, 191, 127, 55, 205, 63]],
    ] as const)(`${mode}: binds the solarize percentage to the threshold in %j`, async (geometry, expected) => {
        const input = await sharp(Uint8Array.from([0, 1, 0, 64, 128, 200, 50, 192]), {
            raw: { width: 2, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", "-solarize", geometry, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
