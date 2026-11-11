import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PPM pixels 465a78 / 4d617f.
const fixtures = [
    { space: "sRGB", format: "rgb", enhance: true, expected: "485c7a4b5f7d" },
    { space: "HSL", format: "rgb", enhance: true, expected: "485c7a4b5f7d" },
    { space: "Lab", format: "rgb", enhance: true, expected: "485d7b4b5f7e" },
    { space: "CMYK", format: "rgb", enhance: true, expected: "485c7a4b5f7d" },
    { space: "CMYK", format: "cmyk", enhance: true, expected: "693f0085663d0082" },
    { space: "CMYK", format: "cmyk", enhance: false, expected: "6a400087643c0080" },
    {"space": "HSL", "format": "rgba", "enhance": true, "name": "precision", "options": [], "depth": 16, "expected": "48565c6f7a96ffff4b305f497d70ffff"},
    {"space": "HSL", "format": "rgba", "enhance": true, "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "60%", "+channel"], "depth": 16, "expected": "48565c6f7a969a2e4b305f497d709a2e"},
    {"space": "HSL", "format": "rgba", "enhance": true, "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "49485d627b8bffff4a3b5e557c7effff"},
    {"space": "HSL", "format": "rgba", "enhance": true, "name": "twice", "options": ["-enhance"], "depth": 16, "expected": "492e5d487b71ffff4a565e6f7c99ffff"},
    {"space": "Lab", "format": "rgba", "enhance": true, "name": "precision", "options": [], "depth": 16, "expected": "48605c6e7a8cffff4b3a5f477d65ffff"},
    {"space": "Lab", "format": "rgba", "enhance": true, "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "60%", "+channel"], "depth": 16, "expected": "48605c6e7a8c9a2e4b3a5f477d659a2e"},
    {"space": "Lab", "format": "rgba", "enhance": true, "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "49535d617b7fffff4a465e547c72ffff"},
    {"space": "Lab", "format": "rgba", "enhance": true, "name": "twice", "options": ["-enhance"], "depth": 16, "expected": "493b5d467b64ffff4a635e6e7c8cffff"},
    {"space": "CMYK", "format": "cmyka", "enhance": true, "name": "precision", "options": [], "depth": 16, "expected": "68eb3ef400018571ffff66893d8600018297ffff"},
    {"space": "CMYK", "format": "cmyka", "enhance": true, "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "60%", "+channel"], "depth": 16, "expected": "68eb3ef4000185719a2e66893d86000182979a2e"},
    {"space": "CMYK", "format": "cmyka", "enhance": true, "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "68203e7a0001847effff67553e000001838affff"},
    {"space": "CMYK", "format": "cmyka", "enhance": true, "name": "twice", "options": ["-enhance"], "depth": 16, "expected": "68363e8700018498ffff673f3df300018371ffff"},
    { space: "CMYK", format: "cmyk", enhance: true, name: "black distance", pixels: "202020e0e0e0", expected: "000000df0000001f" },
    {"space": "HSL", "format": "rgba", "enhance": true, "name": "multiple storage blocks", "width": 1032, "depth": 16, "expected": "5f20d374bb73f2884f3c11e7888f7a08f7c52a3ceda614103f3d57a58b6044d9"},
    {"space": "Lab", "format": "rgba", "enhance": true, "name": "multiple storage blocks", "width": 1032, "depth": 16, "expected": "0ed39605bb2ede786125caae5b92b7e3935f4b2d8e2eb7e89bc66d0e886f697a"},
    {"space": "CMYK", "format": "cmyka", "enhance": true, "name": "multiple storage blocks", "width": 1032, "depth": 16, "expected": "83e00066687632d77f37eacc959984f001787b6b710fb4ae22e73f0123c3a150"},
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`enhances active $space samples into $format (enhance=$enhance, $name, ${mode})`, async fixture => {
        const { space, format, enhance, expected } = fixture;
        const options = "options" in fixture ? fixture.options : [];
        const depth = "depth" in fixture ? fixture.depth : 8;
        const width = "width" in fixture ? fixture.width : 2;
        const pixels = "pixels" in fixture ? fixture.pixels : "465a784d617f";
        const input = Buffer.concat([Buffer.from(`P6\n${width} 1\n255\n`), Buffer.from(pixels.repeat(width / 2), "hex")]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-colorspace", space, ...options, ...(enhance ? ["-enhance"] : []), "-depth", String(depth), "-endian", "MSB", `${format}:/out.raw`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(width > 2 ? createHash("sha256").update(output).digest("hex") : Buffer.from(output).toString("hex")).toBe(expected);
    });
}
