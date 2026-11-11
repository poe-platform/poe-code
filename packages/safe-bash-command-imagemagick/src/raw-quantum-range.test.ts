import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#12345680, MSB, depths 16/32/64.
const fixtures = [
    {"coder": "rgb", "defines": [], "hex": ["2c8532873565", "3d9090913e50d0d13eacacad", "3fb21212121212123fca1a1a1a1a1a1a3fd5959595959596"]},
    {"coder": "rgb", "defines": ["maximum=255"], "hex": ["2c8532873565", "419000004250000042ac0000", "4032000000000000404a0000000000004055800000000000"]},
    {"coder": "rgb", "defines": ["minimum=-1"], "hex": ["2c8532873565", "bf5bdbdcbf179798bea6a6a7", "bfeb7b7b7b7b7b7cbfe2f2f2f2f2f2f3bfd4d4d4d4d4d4d4"]},
    {"coder": "rgb", "defines": ["scale=2"], "hex": ["2c8532873565", "4510900045d0d000462cac00", "40a212000000000040ba1a000000000040c5958000000000"]},
    {"coder": "rgb", "defines": ["minimum=-1", "maximum=255", "scale=2"], "hex": ["2c8532873565", "4510800045d0c800462ca800", "40a210000000000040ba19000000000040c5950000000000"]},
    {"coder": "rgba", "defines": [], "hex": ["2c85328735653804", "3d9090913e50d0d13eacacad3f008081", "3fb21212121212123fca1a1a1a1a1a1a3fd59595959595963fe0101010101010"]},
    {"coder": "rgba", "defines": ["maximum=255"], "hex": ["2c85328735653804", "419000004250000042ac000043000000", "4032000000000000404a00000000000040558000000000004060000000000000"]},
    {"coder": "rgba", "defines": ["minimum=-1"], "hex": ["2c85328735653804", "bf5bdbdcbf179798bea6a6a73b808081", "bfeb7b7b7b7b7b7cbfe2f2f2f2f2f2f3bfd4d4d4d4d4d4d43f70101010101000"]},
    {"coder": "rgba", "defines": ["scale=2"], "hex": ["2c85328735653804", "4510900045d0d000462cac0046808000", "40a212000000000040ba1a000000000040c595800000000040d0100000000000"]},
    {"coder": "rgba", "defines": ["minimum=-1", "maximum=255", "scale=2"], "hex": ["2c85328735653804", "4510800045d0c800462ca80046807e00", "40a210000000000040ba19000000000040c595000000000040d00fc000000000"]},
    {"coder": "gray", "defines": [], "hex": ["31ed", "3e3da309", "3fc7b46114611461"]},
    {"coder": "gray", "defines": ["maximum=255"], "hex": ["31ed", "423ce566", "40479cacb34cb34d"]},
    {"coder": "gray", "defines": ["minimum=-1"], "hex": ["31ed", "bf212e7c", "bfe425cf75cf75d0"]},
    {"coder": "gray", "defines": ["scale=2"], "hex": ["31ed", "45bda24b", "40b7b44960000000"]},
    {"coder": "gray", "defines": ["minimum=-1", "maximum=255", "scale=2"], "hex": ["31ed", "45bd9a4b", "40b7b34960000000"]},
    {"coder": "cmyka", "defines": [], "hex": ["3a5336530000394d3804", "3f4a6b293eca6b29000000003f29a9aa3f008081", "3fe94d652d652d653fd94d652d652d6500000000000000003fe53535353535353fe0101010101010"]},
    {"coder": "cmyka", "defines": ["maximum=255"], "hex": ["3a5336530000394d3804", "4349a0be42c9a0be000000004329000043000000", "40693417c837c83840593417c837c838000000000000000040652000000000004060000000000000"]},
    {"coder": "cmyka", "defines": ["minimum=-1"], "hex": ["3a5336530000394d3804", "3f14d653be56535abf8000003ea6a6a73b808081", "3fe29aca5aca5acabfcaca6b4a6b4a6cbff00000000000003fd4d4d4d4d4d4d43f70101010101000"]},
    {"coder": "cmyka", "defines": ["scale=2"], "hex": ["3a5336530000394d3804", "46ca6a5f464a6a5f0000000046a9a90046808000", "40d94d4be000000040c94d4be0000000000000000000000040d535200000000040d0100000000000"]},
    {"coder": "cmyka", "defines": ["minimum=-1", "maximum=255", "scale=2"], "hex": ["3a5336530000394d3804", "46ca685f464a665fbf80000046a9a70046807e00", "40d94d0be000000040c94ccbe0000000bff000000000000040d534e00000000040d00fc000000000"]},
    {"coder": "rgb", "defines": ["minimum=2", "maximum=2"], "hex": ["2c8532873565", "3e1090913ed0d0d13f2cacad", "3fc21212121212123fda1a1a1a1a1a1a3fe5959595959596"]},
    {"coder": "rgb", "defines": ["minimum=0", "maximum=0"], "hex": ["2c8532873565", "459090004650d00046acac00", "40b212000000000040ca1a000000000040d5958000000000"]},
    {"coder": "rgb", "defines": ["scale=0"], "hex": ["2c8532873565", "459090004650d00046acac00", "40b212000000000040ca1a000000000040d5958000000000"]},
    {"coder": "rgb", "defines": ["scale=-2"], "hex": ["2c8532873565", "c5109000c5d0d000c62cac00", "c0a2120000000000c0ba1a0000000000c0c5958000000000"]}
];
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const endian of ["MSB", "LSB"]) {
        it.each(fixtures)(`${mode} ${endian}: $coder $defines`, async ({ coder, defines, hex }) => {
            for (const [index, depth] of [16, 32, 64].entries()) {
                const args = ["xc:#12345680", "-depth", String(depth), "-endian", endian,
                    "-define", "quantum:format=floating-point",
                    ...defines.flatMap(value => ["-define", `quantum:${value}`]), `${coder}:-`];
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(args, new Map()) : await runMagickCli(args, new Map());
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const expected = Buffer.from(hex[index]!, "hex");
                if (endian === "LSB") {
                    if (depth === 16) expected.swap16();
                    else if (depth === 32) expected.swap32();
                    else expected.swap64();
                }
                expect(Buffer.from(mode === "command" ? Buffer.concat(stdout)
                    : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()), `depth ${depth}`).toEqual(expected);
            }
        });
    }
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it.each([32, 64])(`${mode}: intermediate writes capture quantum defines and resets at depth %s`, async depth => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#12345680", "-depth", String(depth), "-endian", "MSB", "-define", "quantum:format=floating-point",
            "-define", "quantum:minimum=-1", "-define", "quantum:maximum=255", "-define", "quantum:scale=2",
            "-write", "rgb:/ranged", "+define", "quantum:scale", "+define", "quantum:minimum", "+define", "quantum:maximum", "rgb:/reset"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const read = async (path: string) => Buffer.from(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!).toString("hex");
        expect(await read("/ranged")).toBe(fixtures[4]!.hex[depth === 32 ? 1 : 2]);
        expect(await read("/reset")).toBe(fixtures[0]!.hex[depth === 32 ? 1 : 2]);
    });
    it.each([false, true])(`${mode}: split outputs retain quantum defines, intermediate=%s`, async intermediate => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#12345680", "xc:#12345680", "-depth", "32", "-endian", "MSB", "-define", "quantum:format=floating-point",
            "-define", "quantum:maximum=255", "+adjoin", ...(intermediate ? ["-write", "rgb:/out", "null:"] : ["rgb:/out"])];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/out-0", "/out-1"]) {
            expect(Buffer.from(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!).toString("hex")).toBe(fixtures[1]!.hex[1]);
        }
    });
}
