import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: shared RGBA8 PNG input, decoded PNG32 output.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==", "base64");
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    { region: true, expected: "0d315685cdfc2b0189b8e77d4574a3f901224375bbea21dc6695c480356392e999143265aad80be14a68715d245280d9" },
    { region: false, expected: "11406f85cdfc2b0189b8e77d4574a3f901305f75bbea21dc6695c480346392e8f1204f65afd90edc7ead8e72275685d2" },
])(`${mode}: matches native translucent swirl with region=$region`, async ({ region, expected }) => {
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", ...(region ? ["-region", "2x2+1+0"] : []), "-swirl", "30", ...(region ? ["+region"] : []), "PNG32:/out.png"];
    const commandArgs = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: commandArgs.args, argumentValues: commandArgs, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([4, 3]);
    expect(Buffer.from(output.data).toString("hex")).toBe(expected);
});
