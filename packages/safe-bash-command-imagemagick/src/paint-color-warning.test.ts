import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Pixel expectations verified with native ImageMagick 7.1.2.
for (const mode of ["buffered", "sync", "command"] as const)
for (const [operator, expected, blackExpected] of [
    ["-opaque", "1964dc801a64dc80", "aabbcc4400000000"],
    ["+opaque", "aabbcc44aabbcc44", "000000ffaabbcc44"],
    ["-transparent", "1964dc801a64dc80", "0000000000000000"],
    ["+transparent", "1964dc001a64dc00", "000000ff00000000"],
] as const)
for (const [input, pixels] of [["1964dc801a64dc80", expected], ["000000ff00000000", blackExpected]] as const)
it(`${mode}: ${operator} warns and paints using black for an unknown target (${input})`, async () => {
    const metadata = { height: 1, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true } as const;
    const source = encodeImage({ ...metadata, width: 2, data: Buffer.from(input, "hex") }, { format: "png" }).data;
    const destination = encodeImage({ ...metadata, width: 1, data: Buffer.from("ff0000ff", "hex") }, { format: "png" }).data;
    const files = new Map<string, Uint8Array>([["/in.png", source], ["/out.png", destination]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "-fill", "#aabbcc44", operator, "notacolor", "PNG32:/out.png"];
    let stderr = "";
    const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toContain("unrecognized color `notacolor'");
    expect(Buffer.from(decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toString("hex")).toBe(pixels);
});

it("keeps invalid fill colors fatal", () => {
    const files = new Map<string, Uint8Array>();
    const result = runConvertCliSync(["xc:red", "-fill", "notacolor", "-opaque", "red", "out.png"], files);
    expect(result.exitCode).toBe(1);
    expect(files.has("out.png")).toBe(false);
});
