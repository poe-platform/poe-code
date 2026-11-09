import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// GrayAlpha and truecolor PNGs; expected pixels from native ImageMagick
// input.png -channel CHANNEL [-gamma | +gamma] 2 +channel PNG32:out.png,
// decoded with out.png -depth 8 rgba:-.
const inputs = {
    "gray": "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfqCwkOKDLuxz7/AAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA5VDE0OjM5OjIwKzAwOjAwa/dI5AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOVQxNDozOToyMCswMDowMBqq8FgAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDlUMTQ6NDA6NTArMDA6MDCSVObXAAAADUlEQVQI12OskBPJBAAC1QEV5bpd0AAAAABJRU5ErkJggg==",
    "rgba": "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURSV4y47hNBeS79EAAAACdFJOUx6H0Q7kZAAAAAd0SU1FB+oLCQ4oMu7HPv8AAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDlUMTQ6Mzk6MjArMDA6MDBr90jkAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA5VDE0OjM5OjIwKzAwOjAwGqrwWAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOVQxNDo0MDo1MCswMDowMJJU5tcAAAAKSURBVAjXY3AAAABCAEGDueytAAAAAElFTkSuQmCC"
} as const;
const cases: { input: keyof typeof inputs; options: string[]; expected: number[] }[] = [
    {"input": "gray", "options": ["-channel", "R", "-gamma", "2", "+channel"], "expected": [175, 175, 175, 30, 189, 189, 189, 135]},
    {"input": "gray", "options": ["-channel", "G", "-gamma", "2", "+channel"], "expected": [120, 120, 120, 30, 140, 140, 140, 135]},
    {"input": "gray", "options": ["-channel", "B", "-gamma", "2", "+channel"], "expected": [120, 120, 120, 30, 140, 140, 140, 135]},
    {"input": "gray", "options": ["-channel", "Gray", "-gamma", "2", "+channel"], "expected": [175, 175, 175, 30, 189, 189, 189, 135]},
    {"input": "gray", "options": ["-channel", "RGB", "-gamma", "2", "+channel"], "expected": [175, 175, 175, 30, 189, 189, 189, 135]},
    {"input": "gray", "options": ["-channel", "A", "-gamma", "2", "+channel"], "expected": [120, 120, 120, 87, 140, 140, 140, 186]},
    {"input": "gray", "options": ["-channel", "RGBA", "-gamma", "2", "+channel"], "expected": [175, 175, 175, 87, 189, 189, 189, 186]},
    {"input": "gray", "options": ["-channel", "R", "+gamma", "2", "+channel"], "expected": [56, 56, 56, 30, 77, 77, 77, 135]},
    {"input": "gray", "options": ["-channel", "G", "+gamma", "2", "+channel"], "expected": [120, 120, 120, 30, 140, 140, 140, 135]},
    {"input": "gray", "options": ["-channel", "B", "+gamma", "2", "+channel"], "expected": [120, 120, 120, 30, 140, 140, 140, 135]},
    {"input": "gray", "options": ["-channel", "Gray", "+gamma", "2", "+channel"], "expected": [56, 56, 56, 30, 77, 77, 77, 135]},
    {"input": "gray", "options": ["-channel", "RGB", "+gamma", "2", "+channel"], "expected": [56, 56, 56, 30, 77, 77, 77, 135]},
    {"input": "gray", "options": ["-channel", "A", "+gamma", "2", "+channel"], "expected": [120, 120, 120, 4, 140, 140, 140, 71]},
    {"input": "gray", "options": ["-channel", "RGBA", "+gamma", "2", "+channel"], "expected": [56, 56, 56, 4, 77, 77, 77, 71]},
    {"input": "rgba", "options": ["-channel", "R", "-gamma", "2", "+channel"], "expected": [97, 120, 203, 30, 190, 225, 52, 135]},
    {"input": "rgba", "options": ["-channel", "G", "-gamma", "2", "+channel"], "expected": [37, 175, 203, 30, 142, 240, 52, 135]},
    {"input": "rgba", "options": ["-channel", "B", "-gamma", "2", "+channel"], "expected": [37, 120, 228, 30, 142, 225, 115, 135]},
    {"input": "rgba", "options": ["-channel", "Gray", "-gamma", "2", "+channel"], "expected": [97, 120, 203, 30, 190, 225, 52, 135]},
    {"input": "rgba", "options": ["-channel", "RGB", "-gamma", "2", "+channel"], "expected": [97, 175, 228, 30, 190, 240, 115, 135]},
    {"input": "rgba", "options": ["-channel", "A", "-gamma", "2", "+channel"], "expected": [37, 120, 203, 87, 142, 225, 52, 186]},
    {"input": "rgba", "options": ["-channel", "RGBA", "-gamma", "2", "+channel"], "expected": [97, 175, 228, 87, 190, 240, 115, 186]},
    {"input": "rgba", "options": ["-channel", "R", "+gamma", "2", "+channel"], "expected": [5, 120, 203, 30, 79, 225, 52, 135]},
    {"input": "rgba", "options": ["-channel", "G", "+gamma", "2", "+channel"], "expected": [37, 56, 203, 30, 142, 199, 52, 135]},
    {"input": "rgba", "options": ["-channel", "B", "+gamma", "2", "+channel"], "expected": [37, 120, 162, 30, 142, 225, 11, 135]},
    {"input": "rgba", "options": ["-channel", "Gray", "+gamma", "2", "+channel"], "expected": [5, 120, 203, 30, 79, 225, 52, 135]},
    {"input": "rgba", "options": ["-channel", "RGB", "+gamma", "2", "+channel"], "expected": [5, 56, 162, 30, 79, 199, 11, 135]},
    {"input": "rgba", "options": ["-channel", "A", "+gamma", "2", "+channel"], "expected": [37, 120, 203, 4, 142, 225, 52, 71]},
    {"input": "rgba", "options": ["-channel", "RGBA", "+gamma", "2", "+channel"], "expected": [5, 56, 162, 4, 79, 199, 11, 71]},
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: applies $options to actual $input channels`, async ({ input, options, expected }) => {
        const png = Buffer.from(inputs[input], "base64");
        const files = new Map<string, Uint8Array>([["input.png", png]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", png);
        const argv = ["input.png", ...options, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(expected);
    });
}
