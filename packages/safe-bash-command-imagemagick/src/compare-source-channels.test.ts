import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the comparison canvas retains the first source's mask.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const depth of [8, 16])
for (const operation of [["-layers", "CompareAny"], ["-layers", "CompareOverlay"], ["-deconstruct"]])
it.each([
    { first: "G", second: "G", draw: false, geometry: "", pixels: "" },
    { first: "G", second: "G", draw: true, geometry: "", pixels: "" },
    { first: "RGBA", second: "RGBA", draw: false, geometry: "2x1+0+0;", pixels: "888080888080" },
    { first: "Default", second: "Default", draw: true, geometry: "2x1+0+0;", pixels: "888080ffffff" },
    { first: "A", second: "RGBA", draw: true, geometry: "", pixels: "" },
    { first: "RGBA", second: "RGBA", draw: true, geometry: "2x1+0+0;", pixels: "888080ffffff" },
    { first: "GA", second: "GA", draw: true, geometry: "1x1+1+0;", pixels: "ffffff" },
    { first: "GA", second: "RGBA", draw: false, geometry: "", pixels: "" },
    { first: "RGBA", second: "G", draw: true, geometry: "2x1+0+0;", pixels: "888080ffffff" },
    { first: "G", second: "RGBA", draw: true, geometry: "", pixels: "" },
])(`${mode}, ${depth}-bit: ${operation.join(" ")} uses $first source channels with $second next (draw=$draw)`, async ({ first, second, draw, geometry, pixels }) => {
    const input = ["-respect-parentheses", "(", "-size", "2x1", depth === 16 ? "xc:#808080808080" : "xc:#808080", "-channel", first, ")",
        "(", "-size", "2x1", depth === 16 ? "xc:#888880808080" : "xc:#888080", ...(draw ? ["-fill", "white", "-draw", "point 1,0"] : []), "-channel", second, ")", ...operation];
    for (const output of ["geometry", "pixels"]) {
        const argv = [...input, ...(output === "geometry" ? ["-format", "%wx%h%O;", "info:"] : ["-depth", String(depth), "-endian", "MSB", "rgb:-"])];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(argv.includes("-deconstruct")
            ? `magick: option has been replaced '-deconstruct', use "-layers CompareAny" at CLI arg ${argv.indexOf("-deconstruct") + 1}\n` : "");
        if (output === "geometry") {
            const text = "stdout" in result ? result.stdout : Buffer.concat(chunks).toString();
            expect(text).toBe("2x1+0+0;" + geometry);
        } else {
            const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
            const expected = Buffer.from("808080808080" + pixels, "hex");
            expect(Buffer.from(bytes)).toEqual(depth === 16 ? Buffer.from([...expected].flatMap(byte => [byte, byte])) : expected);
        }
    }
});
