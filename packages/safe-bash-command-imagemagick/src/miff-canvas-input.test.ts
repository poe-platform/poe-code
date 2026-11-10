import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 4x2 RGBA input, -compress None,
// optionally -repage 8x6+2+1. Nonstructural native header properties are omitted.
const rgba = Buffer.from("1234abcdff0080ff1234abcd55660080".repeat(2), "hex");
function fixture(page: string, depth = 16) {
    const header = new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=4 rows=2 depth=${depth}\ncolorspace=sRGB compression=None\npage=${page}\n\f\n:\x1a`);
    return new Uint8Array([...header, ...(depth === 16 ? [...rgba].flatMap(value => [value, value]) : rgba)]);
}

for (const mode of ["command", "sync"] as const) {
    it.each([
        { page: "8x6+2+1", args: ["-format", "%g", "info:"], stdout: "8x6+2+1" },
        { page: "4x2+0+0", args: ["-format", "%g", "info:"], stdout: "4x2+0+0" },
        { page: "8x6+2+1", args: ["-background", "black", "-flatten", "-depth", "8", "rgba:out.raw"], length: 192, hash: "70f9a49592e32f59a4d6172317e837bcc41307381b6fb18f53603d39e811e9bf" },
        { page: "4x2+0+0", depth: 8, args: ["-depth", "8", "rgba:out.raw"], length: 32 }
    ])(`${mode}: reads page $page for $args`, async ({ page, depth, args, stdout, length, hash }) => {
        const bytes = fixture(page, depth), filesystem = new MemoryFileSystem();
        const files = new Map([["in.miff", bytes], ["out.raw", new TextEncoder().encode("KEEP")]]);
        for (const [name, content] of files) await filesystem.writeFile(`/${name}`, content);
        let actualStdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(["in.miff", ...args], files) : await createMagickCommand().execute({
            command: "magick", args: ["in.miff", ...args], cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { actualStdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        expect("stdout" in result ? result.stdout : actualStdout).toBe(stdout ?? "");
        const output = mode === "sync" ? files.get("out.raw")! : await filesystem.readFile("/out.raw");
        if (length !== undefined) {
            expect(output.length).toBe(length);
            if (hash) expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
            else expect([...output]).toEqual([...rgba]);
        } else expect(new TextDecoder().decode(output)).toBe("KEEP");
    });
}
