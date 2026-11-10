import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 4x3 -depth 8 rgba:seed.rgba -strip PNG32:input.png.
// Seed: 11406f85cdfc2b0189b8e77d4574a3f901305f75bdec1bf179a8d76d356493e9f1204f65addc0be16998c75d255483d9.
// References decoded from native PNG32 output using -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==", "base64");
const cases = [
    {
        name: "rectangular region",
        options: ["-region", "2x2+1+0", "-auto-level", "+region"],
        expected: "0a264285cfff2b008abaea7e4574a3f900183075bfef1af47aaad96e346391e9620d2065a9d60be12636475d23507ed9",
    },
    {
        name: "R region",
        options: ["-channel", "R", "-region", "2x2+1+0", "-auto-level", "+region", "+channel"],
        expected: "0a406f85d9fc2b0191b8e77d4574a3f900305f75c8ec1bf180a8d76d346493e963204f65a9dc0be12698c75d245483d9",
    },
    {
        name: "RGB region",
        options: ["-channel", "RGB", "-region", "2x2+1+0", "-auto-level", "+region", "+channel"],
        expected: "0a214385d9ff250191b0ff7d4573a3f900133075c8ec13f1809eec6d346192e963082065a9d60ae12634495d244d7ed9",
    },
    {
        name: "unscoped control",
        options: ["-auto-level"],
        expected: "10407086cfff2b008abaea7e4575a5fc00305f76bfef1af47aaad96e356594ecf41f4f66afde0ae46a99c95d255484db",
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`matches every native auto-level pixel for $name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const argv = ["input.png", ...options, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
