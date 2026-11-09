import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = [
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAEklEQVR4nGO4wyX3HxkzEBQAAGT5GCWP9zVLAAAAAElFTkSuQmCC",
    "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGPg0rj0H4YZkDkAkmkMEySm8r8AAAAASUVORK5CYII=",
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNg+A+BAA/5A/3YOXFBAAAAAElFTkSuQmCC"
].map(value => Buffer.from(value, "base64"));
const colors = Object.fromEntries(inputs.map((bytes, index) => ["ABG"[index]!, Array.from(decodeImage(bytes).data.slice(0, 4))]));
colors["."] = [255, 255, 255, 255];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const vertical of [false, true]) {
    const gravity = vertical ? "East" : "South", operation = vertical ? "-smush" : "+smush";
    const grouped = ["/a.png", "(", "/b.png", "-gravity", gravity, ")", "/g.png"];
    // ImageMagick 7.1.2-35 Q16-HDRI RGBA8 references; vertical cases transpose each input.
    it.each([
        { name: "default settings escape the group", args: grouped, rows: ["AAAA.....", "AAAABBB..", "AAAABBBGG"] },
        { name: "respect preserves each image's gravity", args: ["-respect-parentheses", ...grouped], rows: ["AAAA...GG", "AAAABBB..", "AAAABBB.."] },
        { name: "reset respect", args: ["-respect-parentheses", "+respect-parentheses", ...grouped], rows: ["AAAA.....", "AAAABBB..", "AAAABBBGG"] },
        { name: "reset gravity updates all images", args: ["-respect-parentheses", ...grouped, "+gravity"], rows: ["AAAABBBGG", "AAAABBB..", "AAAA....."] },
        { name: "override after group updates all images", args: ["-respect-parentheses", ...grouped, "-gravity", gravity], rows: ["AAAA.....", "AAAABBB..", "AAAABBBGG"] },
        { name: "nested groups", args: ["-respect-parentheses", "/a.png", "(", "(", "/b.png", "-gravity", gravity, ")", ")", "/g.png"], rows: ["AAAA...GG", "AAAABBB..", "AAAABBB.."] },
        { name: "setting before input", args: ["-respect-parentheses", "/a.png", "(", "-gravity", gravity, "/b.png", ")", "/g.png"], rows: ["AAAA...GG", "AAAABBB..", "AAAABBB.."] },
        { name: "clone retains gravity", args: ["-respect-parentheses", "/a.png", "(", "/b.png", "-gravity", gravity, ")", "+clone"], rows: ["AAAA......", "AAAABBBBBB", "AAAABBBBBB"] },
        { name: "smush result retains gravity", args: ["-respect-parentheses", "/a.png", "(", "/b.png", "-gravity", gravity, "+smush", "0", ")", "/g.png"], rows: ["AAAA...GG", "AAAABBB..", "AAAABBB.."] },
        { name: "gravity survives stored metadata eviction", args: ["-respect-parentheses", "/a.png", "(", ...Array<string>(36).fill("/b.png"), "-gravity", gravity, ")", "/g.png"], rows: ["AAAA" + ".".repeat(108) + "GG", "AAAA" + "B".repeat(108) + "..", "AAAA" + "B".repeat(108) + ".."] },
    ])(`${mode} ${operation}: $name`, async ({ args, rows }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        for (const [index, path] of ["/a.png", "/b.png", "/g.png"].entries()) {
            files.set(path, inputs[index]!);
            await fs.writeFile(path, inputs[index]!);
        }
        const argv = [...args, ...(vertical ? ["-transpose"] : []), operation, "0", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        const expected = vertical ? Array.from({ length: rows[0]!.length }, (_, x) => rows.map(row => row[x]!).join("")) : rows;
        expect([actual.width, actual.height]).toEqual([expected[0]!.length, expected.length]);
        expect(Array.from(actual.data)).toEqual(expected.flatMap(row => [...row].flatMap(pixel => colors[pixel]!)));
    });
}
