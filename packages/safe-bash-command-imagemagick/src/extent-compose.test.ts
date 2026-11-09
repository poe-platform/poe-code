import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./extent-compose-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI; PNG32/PNG64 outputs decoded independently to RGBA, LSB.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each(fixtures.cases)(`${mode}: $depth-bit $compose onto $background, $gravity $geometry`, async ({ depth, args, width, height, rgba }) => {
        const input = Buffer.from(depth === 16 ? fixtures.input16 : fixtures.input, "base64");
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const argv = ["/in.png", ...args, `${depth === 16 ? "PNG64" : "PNG32"}:/out.png`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = Buffer.from(rgba, "base64");
        if (depth === 16) {
            expect(output.data16).toBeDefined();
            expect(Array.from(output.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16LE(i * 2)));
        } else expect(output.data).toEqual(new Uint8Array(expected));
    });
}
