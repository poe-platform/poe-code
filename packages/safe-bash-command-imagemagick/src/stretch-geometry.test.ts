import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./stretch-geometry-fixtures.json" with { type: "json" };

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: native $operation geometry $argument`, async ({ operation, argument, rgba }) => {
        const input = Uint8Array.from(Buffer.from(fixtures.input, "base64"));
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const argv = ["/in.png", operation, argument, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(decodeImage(output).data).toEqual(Uint8Array.from(Buffer.from(rgba, "base64")));
    });
}
