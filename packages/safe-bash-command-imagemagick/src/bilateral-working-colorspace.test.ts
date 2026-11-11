import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PPM pixels 0a141e / 5a6e82.
const fixtures = [
    { name: "reported", space: "sRGB", format: "rgb", expected: "14202b506275" },
    { name: "reported", space: "HSL", format: "rgb", expected: "162738445b72" },
    { name: "reported", space: "Lab", format: "rgb", expected: "1e2a36435466" },
    { name: "reported", space: "CMYK", format: "rgb", expected: "15243343586d" },
    { name: "reported", space: "CMYK", format: "cmyk", expected: "964b00cc62310092" },
    {"space": "HSL", "format": "rgba", "name": "red", "options": ["-channel", "R"], "depth": 16, "expected": "0a0a14141e1effff5a5a6e6e8282ffff"},
    {"space": "HSL", "format": "rgba", "name": "black", "options": ["-channel", "K"], "depth": 8, "expected": "0a141eff5a6e82ff"},
    {"space": "HSL", "format": "rgba", "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "80%", "+channel"], "depth": 16, "expected": "67771425406ccccdbaab618c90e8cccd"},
    {"space": "HSL", "format": "rgba", "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "288b3e73545bffff2d88440f5a97ffff"},
    {"space": "Lab", "format": "rgba", "name": "red", "options": ["-channel", "R"], "depth": 16, "expected": "20d129b23462ffff40d554d267fcffff"},
    {"space": "Lab", "format": "rgba", "name": "black", "options": ["-channel", "K"], "depth": 8, "expected": "0a141eff5a6e82ff"},
    {"space": "Lab", "format": "rgba", "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "80%", "+channel"], "depth": 16, "expected": "9f3a000021f8cccdf6233aa62a43cccd"},
    {"space": "Lab", "format": "rgba", "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "3368420a5139ffff2d7d3b4a49b5ffff"},
    {"space": "CMYK", "format": "cmyka", "name": "red", "options": ["-channel", "R"], "depth": 16, "expected": "970c55550000e1e1ffff6262276200007d7dffff"},
    {"space": "CMYK", "format": "cmyka", "name": "black", "options": ["-channel", "K"], "depth": 8, "expected": "aa5500ccff4e270092ff"},
    {"space": "CMYK", "format": "cmyka", "name": "alpha", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "80%", "+channel"], "depth": 16, "expected": "ec0176010000ffffcccd99b94cdc0000e58ecccd"},
    {"space": "CMYK", "format": "cmyka", "name": "tile", "options": ["-virtual-pixel", "tile"], "depth": 16, "expected": "7fdb3fee0000b31dffff79933cca0000ac41ffff"},
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`blurs active $space samples into $format ($name, ${mode})`, async fixture => {
        const { space, format, expected } = fixture;
        const options = "options" in fixture ? fixture.options : [];
        const depth = "depth" in fixture ? fixture.depth : 8;
        const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-colorspace", space, ...options, "-bilateral-blur", "3x3+64+1", "-depth", String(depth), "-endian", "MSB", `${format}:/out.raw`];
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
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
