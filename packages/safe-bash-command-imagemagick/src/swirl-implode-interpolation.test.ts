import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./swirl-implode-interpolation-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-35 Q16-HDRI: input.png <args> -depth 8|16 -strip PNG32|64:out.png.
// The opaque 9x7 input reproduces swirl/implode sampling; RGBA covers alpha and 16-bit channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: matches native $kind warp with $args`, async fixture => {
        const input = Buffer.from(fixture.input, "base64"), files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...fixture.args, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const actual = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = decodeImage(Buffer.from(fixture.output, "base64"));
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(fixture.depth === 16 ? actual.data16 : actual.data).toEqual(fixture.depth === 16 ? expected.data16 : expected.data);
    });
}
