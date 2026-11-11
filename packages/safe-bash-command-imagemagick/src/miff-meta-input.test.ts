import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import fixtures from "../../image-ast/src/codecs/miff-meta-fixtures.json" with { type: "json" };
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI fixtures, never written by our encoder.
// Concatenate 4x2 PGM planes, then: magick pgm:- -combine -depth D -compress C miff:-
// 8-bit plane i contains (41*i + 13*j + 5) % 256 for pixel j.
// 16-bit samples add low-order bits: byte*256 + (7*i + 3*j) % 256.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const fixture of fixtures) {
        const cases = [
            { name: "RGBA", options: [], format: "rgba", expected: fixture.rgba },
            ...fixture.meta.map((expected, i) => ({ name: `Meta${i}`, options: ["-channel", `Meta${i}`, "-separate"], format: "gray", expected })),
            { name: "red", options: ["-channel", "R", "-separate"], format: "gray", expected: Array.from({ length: 8 }, (_, i) => fixture.rgba.slice(i * fixture.depth, i * fixture.depth + fixture.depth / 4)).join("") },
            { name: "info", options: ["-format", "%[channels]"], format: "info", expected: `srgba ${fixture.count}.${fixture.count - 4}` },
        ];
        it.each(cases)(`${mode}: ${fixture.count} channels, ${fixture.depth}-bit ${fixture.compression}: $name`, async ({ options, format, expected }) => {
            const input = Buffer.from(fixture.input, "hex"), files = new Map<string, Uint8Array>([["/in.miff", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.miff", input);
            const args = ["/in.miff", ...options, "-depth", String(fixture.depth), "-endian", "MSB", `${format}:/out`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString(format === "info" ? "utf8" : "hex")).toBe(expected);
        });
    }
}
