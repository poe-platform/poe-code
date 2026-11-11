import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: deterministic PPM, working-space contrast,
// then little-endian raw RGBA/CMYKA. Hashes cover every sample, including alpha/K.
const nativeCases = [
    {"space": "HSL", "name": "reported", "width": 7, "height": 5, "geometry": "10x20", "options": [], "depth": 8, "format": "rgba", "hash": "a23dc0b8d7cec87f6b6644e0ecaf65c6764ed9bb01f80048ac599e8388c58514"},
    {"space": "HSL", "name": "neighborhood", "width": 32, "height": 24, "geometry": "100x50", "options": [], "depth": 8, "format": "rgba", "hash": "001d32400a1474389263da850b314f46d46f8eee614698f117cac9a973221ebb"},
    {"space": "HSL", "name": "red", "width": 32, "height": 24, "geometry": "100x50", "options": ["-channel", "R"], "depth": 8, "format": "rgba", "hash": "e3f53dc9a4357e2141dde538496e39718ff008d8daca2c24fc76a8f662e004ec"},
    {"space": "HSL", "name": "alpha", "width": 7, "height": 5, "geometry": "10x20", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "40%", "+channel"], "depth": 16, "format": "rgba", "hash": "f633fb6f7ac5ec86d11623fa569d15fde46522caf49e7ba484bbd860a5e7c8e1"},
    {"space": "HSL", "name": "black", "width": 7, "height": 5, "geometry": "10x20", "options": ["-channel", "K"], "depth": 8, "format": "rgba", "hash": "db8dd5270cfab608418eb9d63135f8a4d62a22aed1f01c2a0073bb84bfa81ac8"},
    {"space": "HSL", "name": "zero", "width": 7, "height": 5, "geometry": "10x0", "options": [], "depth": 8, "format": "rgba", "hash": "150cc8e857d994072df312bf06261d4b3ffbe83c84ea9a32dfe008c3bf3b2f5e"},
    {"space": "Lab", "name": "reported", "width": 7, "height": 5, "geometry": "10x20", "options": [], "depth": 8, "format": "rgba", "hash": "c53a88631f408542714053eda33a83668dfc0bd270509854e46aa092cf5807ad"},
    {"space": "Lab", "name": "neighborhood", "width": 32, "height": 24, "geometry": "100x50", "options": [], "depth": 8, "format": "rgba", "hash": "d45876bf2d1380ee21d8043030bf33fff5fefce2557307e2b4be7475893e7627"},
    {"space": "Lab", "name": "red", "width": 32, "height": 24, "geometry": "100x50", "options": ["-channel", "R"], "depth": 8, "format": "rgba", "hash": "ab53ab185e9ecd3e97c14c528d64b73d01eab4a75b56bef1f892f079ea1fa634"},
    {"space": "Lab", "name": "alpha", "width": 7, "height": 5, "geometry": "10x20", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "40%", "+channel"], "depth": 16, "format": "rgba", "hash": "c6f38b268b1478a1b8f27dcc4ceefc2ea9dc17aa3e8e254fa4728d19ea905635"},
    {"space": "Lab", "name": "black", "width": 7, "height": 5, "geometry": "10x20", "options": ["-channel", "K"], "depth": 8, "format": "rgba", "hash": "db8dd5270cfab608418eb9d63135f8a4d62a22aed1f01c2a0073bb84bfa81ac8"},
    {"space": "Lab", "name": "zero", "width": 7, "height": 5, "geometry": "10x0", "options": [], "depth": 8, "format": "rgba", "hash": "0edc30f75bc98944dcdc443390d5dced2a992d1e09f1affc304694ac1be25cdc"},
    {"space": "CMYK", "name": "reported", "width": 7, "height": 5, "geometry": "10x20", "options": [], "depth": 8, "format": "cmyka", "hash": "ac3d12e1ea70c757ed5435962fbd4cf7a1cae0a4a6887e0bf1aedac1034d1786"},
    {"space": "CMYK", "name": "neighborhood", "width": 32, "height": 24, "geometry": "100x50", "options": [], "depth": 8, "format": "cmyka", "hash": "99f01ec5cafd08f297e9be1485a351ff073035c64c7f28b92552e465f4cfdc91"},
    {"space": "CMYK", "name": "red", "width": 32, "height": 24, "geometry": "100x50", "options": ["-channel", "R"], "depth": 8, "format": "cmyka", "hash": "0848e4d74c60b9b5e8bd3c16abad8f190fd8e23fc6803d8fc2efbd74a47a2f26"},
    {"space": "CMYK", "name": "alpha", "width": 7, "height": 5, "geometry": "10x20", "options": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "40%", "+channel"], "depth": 16, "format": "cmyka", "hash": "1d474cc62615ca3cff3b2d5a775b7622bbeb1e322254542571a5b6520dd556b6"},
    {"space": "CMYK", "name": "black", "width": 7, "height": 5, "geometry": "10x20", "options": ["-channel", "K"], "depth": 8, "format": "cmyka", "hash": "8813a6071b9b945f7c6e204972e44c983acfd27ba5dc6eba760eefc7650f233b"},
    {"space": "CMYK", "name": "zero", "width": 7, "height": 5, "geometry": "10x0", "options": [], "depth": 8, "format": "cmyka", "hash": "8813a6071b9b945f7c6e204972e44c983acfd27ba5dc6eba760eefc7650f233b"},
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(nativeCases)(`matches native $space local contrast ($name) via ${mode}`, async ({ space, width, height, geometry, options, depth, format, hash }) => {
        const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
        const input = new Uint8Array(header.length + width * height * 3);
        input.set(header);
        for (let i = 0; i < width * height * 3; i++) input[header.length + i] = (i * 41 + 51) % 256;
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-colorspace", space, ...options, "-local-contrast", geometry, "-depth", String(depth), "-endian", "LSB", `${format}:/out.raw`];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
