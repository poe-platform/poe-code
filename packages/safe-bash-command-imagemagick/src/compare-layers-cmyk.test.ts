import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function run(argv: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(argv.includes("-deconstruct")
            ? `magick: option has been replaced '-deconstruct', use "-layers CompareAny" at CLI arg ${argv.indexOf("-deconstruct") + 1}\n` : "");
        if (argv.at(-1) === "rgb:-") {
            const bytes = "stdoutBytes" in result ? result.stdoutBytes : Buffer.concat(stdout);
            return Buffer.from(bytes as Uint8Array).toString("hex");
        }
        return "stdout" in result ? result.stdout : Buffer.concat(stdout).toString();
    }

    it.each([
        { first: "xc:black", second: "xc:white", firstSpace: "sRGB", secondSpace: "CMYK", geometry: "2x1+0+0;" },
        { first: "xc:white", second: "xc:black", firstSpace: "CMYK", secondSpace: "sRGB", geometry: "2x1+0+0;" },
        { first: "xc:#808080", second: "xc:white", firstSpace: "CMYK", secondSpace: "CMYK", geometry: "2x1+0+0;2x1+0+0;" },
        { first: "xc:#80808000", second: "xc:#ffffff00", firstSpace: "CMYK", secondSpace: "CMYK", geometry: "2x1+0+0;" },
    ])(`${mode} compares actual channels and alpha: $firstSpace $first -> $secondSpace $second`, async ({ first, second, firstSpace, secondSpace, geometry }) => {
        expect(await run(["-respect-parentheses", "(", "-size", "2x1", first, "-colorspace", firstSpace, ")",
            "(", "-size", "2x1", second, "-colorspace", secondSpace, ")", "-layers", "CompareAny", "-format", "%wx%h%O;", "info:"]))
            .toBe(geometry);
    });

    it(`${mode} distinguishes black ink from an equivalent mix of cyan, magenta and yellow`, async () => {
        expect(await run(["-size", "2x1", "xc:cmyk(0%,0%,0%,50%)", "xc:cmyk(50%,50%,50%,0%)",
            "-layers", "CompareAny", "-format", "%wx%h%O;", "info:"]))
            .toBe("2x1+0+0;2x1+0+0;");
    });

    it(`${mode} preserves canvas black when copying an sRGB frame without black`, async () => {
        expect(await run(["-size", "2x1", "xc:cmyk(0%,0%,0%,50%)", "xc:black",
            "-layers", "CompareAny", "-format", "%wx%h%O;", "info:"]))
            .toBe("2x1+0+0;");
    });

    it(`${mode} compares CMYK spans within the storage transfer limit`, async () => {
        expect(await run(["-respect-parentheses", "(", "-size", "1025x1", "xc:#808080", "-colorspace", "CMYK", ")",
            "(", "-size", "1025x1", "xc:#808080", ")", "-layers", "CompareOverlay", "-format", "%wx%h%O;", "info:"]))
            .toBe("1025x1+0+0;1025x1+0+0;");
    });

    for (const operation of [["-layers", "CompareAny"], ["-layers", "CompareOverlay"], ["-deconstruct"]]) {
        for (const first of ["sRGB", "CMYK"]) for (const second of ["sRGB", "CMYK"]) {
            it(`${mode} ${operation.join(" ")} compares ${first} and ${second} channel values`, async () => {
                const frames = ["-respect-parentheses", "(", "-size", "2x1", "xc:#808080", "-colorspace", first, ")",
                    "(", "-size", "2x1", "xc:#808080", "-colorspace", second, ")"];
                expect(await run([...frames, ...operation, "-format", "%wx%h%O;", "info:"]))
                    .toBe(first === second ? "2x1+0+0;" : "2x1+0+0;2x1+0+0;");
            });
        }
        it(`${mode} ${operation.join(" ")} retains every changed mixed-colorspace pixel`, async () => {
            const frames = ["-respect-parentheses", "(", "-size", "2x1", "xc:#808080", ")",
                "(", "-size", "2x1", "xc:#808080", "-fill", "white", "-draw", "point 1,0", "-colorspace", "CMYK", ")"];
            expect(await run([...frames, ...operation, "-format", "%wx%h%O;", "info:"]))
                .toBe("2x1+0+0;2x1+0+0;");
            expect(await run([...frames, ...operation, "-depth", "8", "rgb:-"]))
                .toBe("808080808080808080ffffff");
        });
    }
}
