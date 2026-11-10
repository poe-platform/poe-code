import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI PNG inputs, preserving sub-byte precision.
const inputs = [
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTI6MzUrMDA6MDB5au+PAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjUyOjM1KzAwOjAwCDdXMwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1MjozNSswMDowMF8iduwAAAAaSURBVAjXY1AXjLxVajxnyQkGRpY5Dv//AwAzgAb76DBMEwAAAABJRU5ErkJggg==",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTI6MzUrMDA6MDB5au+PAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjUyOjM1KzAwOjAwCDdXMwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1MjozNSswMDowMF8iduwAAAARSURBVAjXY1AXirxZajxnKQAMXANVs2Q7IwAAAABJRU5ErkJggg=="
];

for (const mode of ["map", "sync", "retained", "command"] as const)
for (const reverse of [false, true])
it.each([
    { name: "default", flags: [], grouped: true, transparent: true },
    { name: "respect", flags: ["-respect-parentheses"], grouped: true, transparent: reverse },
    { name: "reset respect", flags: ["-respect-parentheses", "+respect-parentheses"], grouped: true, transparent: true },
    { name: "nested", flags: [], grouped: true, nested: true, transparent: true },
    { name: "nested respect", flags: ["-respect-parentheses"], grouped: true, nested: true, transparent: reverse },
    { name: "reset setting preserves loaded method", flags: [], grouped: true, after: ["+virtual-pixel"], transparent: true },
    { name: "override after group", flags: ["-respect-parentheses"], grouped: true, after: ["-virtual-pixel", "transparent"], transparent: true },
    { name: "ungrouped", flags: [], grouped: false, transparent: true },
    { name: "edge control", flags: [], grouped: true, transparent: false, edge: true },
])(`${mode}, reverse=${reverse}: $name virtual pixels across parentheses`, async ({ flags, grouped, transparent, edge, nested, after }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const [index, path] of ["/a.png", "/short.png"].entries()) {
        const bytes = Buffer.from(inputs[index]!, "base64");
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
    }
    const paths = reverse ? ["/short.png", "/a.png"] : ["/a.png", "/short.png"];
    const argv = [...flags, ...(grouped ? nested ? ["(", "("] : ["("] : []), paths[0]!,
        ...(edge ? [] : ["-virtual-pixel", "transparent"]), ...(grouped ? nested ? [")", ")"] : [")"] : []), paths[1]!, ...(after ?? []),
        "-evaluate-sequence", "Mean", "PNG64:/out.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } })
        : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toBe("");
    const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([2, 1]);
    // Native RGBA16 samples: transparent black vs repeated smaller-image edge.
    expect(Array.from(output.data16!)).toEqual([10002, 23002, 30003, 40101,
        ...(transparent ? [25600, 130, 20000, 32768] : [30601, 11631, 35002, 52818])]);
});
