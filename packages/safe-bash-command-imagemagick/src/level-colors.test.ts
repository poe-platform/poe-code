import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./level-colors-fixtures.json" with { type: "json" };

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(fixtures.cases)(`${mode}: $name matches native endpoint mapping`, async ({ source, args, depth, pixels }) => {
        const input = Buffer.from(fixtures.inputs[source as keyof typeof fixtures.inputs], "base64");
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of Object.entries(fixtures.inputs)) files.set(`/${name}.png`, Buffer.from(bytes, "base64"));
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/input.png", ...args, `PNG${depth === 16 ? 64 : 32}:/out.png`];
        let stderr = "";
        const result = mode === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            })
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...(depth === 16 ? output.data16! : output.data)]).toEqual(pixels);
    });
}
