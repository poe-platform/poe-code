import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with identical input bytes and arguments.
const rgb = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
const rgba = new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), 0, 128, 255, 128, 255, 0, 10, 0]);
const gray = new TextEncoder().encode("P2\n4 1\n65535\n0 1 4660 65535\n");
const cases = [
    { name: "explicit precision", input: rgb, options: ["-precision", "12"], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#a0a,#1414,#1e1e|#0A141E|0.0392156862745,0.078431372549,0.117647058824|3.92156862745%,7.8431372549%,11.7647058824%|srgb(10,20,30)|0x1.414p+11,0x1.414p+12,0x1.e1ep+12\n#5a5a,#6e6e,#8282|#5A6E82|0.352941176471%,0.43137254902%,0.509803921569%|35.2941176471%,43.137254902%,50.9803921569%|srgb(90,110,130)|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15\n" },
    { name: "combined RGB", input: rgb, options: [], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#a0a,#1414,#1e1e|#0A141E|0.0392157,0.0784314,0.117647|3.92157%,7.84314%,11.7647%|srgb(10,20,30)|0x1.414p+11,0x1.414p+12,0x1.e1ep+12\n#5a5a,#6e6e,#8282|#5A6E82|0.352941%,0.431373%,0.509804%|35.2941%,43.1373%,50.9804%|srgb(90,110,130)|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15\n" },
    { name: "RGB escape h", input: rgb, options: [], format: "\\h\\n", expected: "#a0a,#1414,#1e1e\n#5a5a,#6e6e,#8282\n" },
    { name: "RGB escape H", input: rgb, options: [], format: "\\H\\n", expected: "#0A141E\n#5A6E82\n" },
    { name: "RGB escape o", input: rgb, options: [], format: "\\o\\n", expected: "0.0392157,0.0784314,0.117647\n0.352941,0.431373,0.509804\n" },
    { name: "RGB escape p", input: rgb, options: [], format: "\\p\\n", expected: "3.92157%,7.84314%,11.7647%\n35.2941%,43.1373%,50.9804%\n" },
    { name: "RGB escape s", input: rgb, options: [], format: "\\s\\n", expected: "srgb(10,20,30)\nsrgb(90,110,130)\n" },
    { name: "RGB escape f", input: rgb, options: [], format: "\\f\\n", expected: "0x1.414p+11,0x1.414p+12,0x1.e1ep+12\n0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15\n" },
    { name: "coordinates and decimal channels", input: rgb, options: [], format: "\\x/\\y=\\c\\n", expected: "0/0=2570,5140,7710\n1/0=23130,28270,33410\n" },
    { name: "alpha", input: rgba, options: [], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#0,#8080,#ffff,#8080|#0080FF80|0,0.501961,1,0.501961|0%,50.1961%,100%,50.1961%|srgba(0,128,255,0.501961)|0x0p+0,0x1.01p+15,0x1.fffep+15,0x1.01p+15\n#ffff,#0,#a0a,#0|#FF000A00|1%,0%,0.0392157%,0%|100%,0%,3.92157%,0%|srgba(255,0,10,0)|0x1.fffep+15,0x0p+0,0x1.414p+11,0x0p+0\n" },
    { name: "Q16 grayscale", input: gray, options: [], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#0|#000000000000|0|0%|gray(0)|0x0p+0\n#1|#000100010001|1.5259e-05%|0.0015259%|gray(0.0015259%)|0x1p+0\n#1234|#123412341234|0.071107%|7.1107%|gray(7.1107%)|0x1.234p+12\n#ffff|#FFFFFFFFFFFF|1%|100%|gray(255)|0x1.fffep+15\n" },
    { name: "explicit depth", input: rgb, options: ["-depth", "16"], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#a0a,#1414,#1e1e|#0A0A14141E1E|0.0392157,0.0784314,0.117647|3.92157%,7.84314%,11.7647%|srgb(10,20,30)|0x1.414p+11,0x1.414p+12,0x1.e1ep+12\n#5a5a,#6e6e,#8282|#5A5A6E6E8282|0.352941%,0.431373%,0.509804%|35.2941%,43.1373%,50.9804%|srgb(90,110,130)|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15\n" },
    { name: "escape ordering", input: rgb, options: [], format: "\\f|\\c|\\h|\\o|\\p\\n", expected: "0x1.414p+11,0x1.414p+12,0x1.e1ep+12|0x1.414p+11,0x1.414p+12,0x1.e1ep+12|#a0a,#1414,#1e1e|0x1.414p+11,0x1.414p+12,0x1.e1ep+12|0x1.414p+11,0x1.414p+12,0x1.e1ep+12\n0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15|#5a5a,#6e6e,#8282|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15|0x1.6968p+14,0x1.b9b8p+14,0x1.0504p+15\n" },
    { name: "fractional channels", input: rgb, options: ["-evaluate", "multiply", "0.25"], format: "\\h|\\H|\\o|\\p|\\s|\\f\\n", expected: "#283,#505,#788|#030508|0.00980392,0.0196078,0.0294118|0.980392%,1.96078%,2.94118%|srgb(0.980392%,1.96078%,2.94118%)|0x1.414p+9,0x1.414p+10,0x1.e1ep+10\n#1697,#1b9c,#20a1|#171C21|0.0882353%,0.107843%,0.127451%|8.82353%,10.7843%,12.7451%|srgb(8.82353%,10.7843%,12.7451%)|0x1.6968p+12,0x1.b9b8p+12,0x1.0504p+13\n" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`expands FTXT color escapes (${mode}): $name`, async ({ input, options, format, expected }) => {
        const files = new Map([["/in", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in", input);
        const args = ["/in", ...options, "-define", `ftxt:format=${format}`, "ftxt:-"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "buffered" ? await runConvertCli(args, files)
            : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}

for (const mode of ["buffered", "retained"] as const) {
    it(`keeps FTXT escape state across stored chunks and writes files (${mode})`, async () => {
        const input = new TextEncoder().encode(`P2\n1 4097\n65535\n${"4660\n".repeat(4097)}`);
        const files = new Map([["/in", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", input);
        const args = ["/in", "-define", "ftxt:format=\\x/\\y=\\o|\\p|\\f\\n", "ftxt:/out"];
        const result = await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out");
        const lines = new TextDecoder().decode(bytes).trimEnd().split("\n");
        expect(lines).toHaveLength(4097);
        expect(lines[0]).toBe("0/0=0.071107|7.1107%|0x1.234p+12");
        expect(lines[4095]).toBe("0/4095=0.071107%|7.1107%|0x1.234p+12");
        expect(lines[4096]).toBe("0/4096=0.071107%|7.1107%|0x1.234p+12");
    });
}
