import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded with -depth 8 rgba:-.
const input = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==";
const control = "002d7695628c7c00b6e6ff6b4170a2ff0000706bd3ff04ff9bd0ff412b5a90ffff006849b7f600ff62afff1f15447eef";
const cases = [
    { name: "translucent region", operations: ["-region", "2x2+1+0", "-sharpen", "0x1", "+region"],
        rgba: "072e5b85628c7c00b6e6ff6b4574a3f900124575d3ff04ff9bd0ff41346393e99e003165b1e308e12e45765d225181d9" },
    { name: "unscoped control", operations: ["-sharpen", "0x1"], rgba: control },
    { name: "reset region", operations: ["-region", "2x2+1+0", "+region", "-sharpen", "0x1"], rgba: control },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`matches native sharpen pixels (${mode}, $name)`, async ({ operations, rgba }) => {
    const png = Buffer.from(input, "base64");
    const files = new Map([["/input.png", png]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", png);
    const tokens = ["/input.png", ...operations, "PNG32:/out.png"];
    if (mode === "command") {
        const args = createCommandArguments(tokens);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        const result = mode === "sync" ? runConvertCliSync(tokens, files)
            : await runConvertCli(tokens, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    }
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([4, 3]);
    expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
});
