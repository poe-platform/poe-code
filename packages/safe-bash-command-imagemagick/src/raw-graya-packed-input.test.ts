import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI; eight pixels leave no trailing row bits.
const fixtures = [
    { depth: 1, input: "1112", output: "ffffff00ffffffffffffff00ffffffffffffff00ffffffffffffff0000000000" },
    { depth: 2, input: "11121314", output: "000000550000005500000055000000aa00000055000000ff0000005555555500" },
    { depth: 3, input: "111213141516", output: "0000009249494924242424004949496d000000b60000002449494992494949db" },
    { depth: 4, input: "1112131415161718", output: "1111111111111122111111331111114411111155111111661111117711111188" },
    { depth: 5, input: "1112131415161718191a", output: "101010214a4a4a0831313129000000ad101010c55a5a5a8c84848431424242d6" },
    { depth: 6, input: "1112131415161718191a1b1c", output: "101010452020204d1414140451515159141414c68282826518181886b2b2b271" },
    { depth: 7, input: "1112131415161718191a1b1c1d1e", output: "1010108985858562404040a95858582e1818180c46464642b1b1b1e17474743c" },
    { depth: 8, input: "1112131415161718191a1b1c1d1e1f20", output: "111111121313131415151516171717181919191a1b1b1b1c1d1d1d1e1f1f1f20" }
];
const cases = fixtures.flatMap(fixture => [
    { ...fixture, size: "8x1", selector: "", fails: false },
    { ...fixture, size: "8x1+1", selector: "[1]", input: "ff" + fixture.input.repeat(2), fails: false },
    { ...fixture, size: "8x1", selector: "", input: fixture.input.slice(0, -2), output: "4b454550", fails: true }
]);

for (const mode of ["file", "stream", "sync"] as const) {
    it.each(cases)(`${mode}: reads $depth-bit GRAYA $size selector $selector (truncated: $fails)`, async ({ depth, input, output, size, selector, fails }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = ["-size", size, "-depth", String(depth), `graya:${mode === "stream" ? "-" : "/in.ppm"}${selector}`, "-depth", "8", "rgba:/out"];
        let actual: Uint8Array, stderr = "", exitCode: number;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/in.ppm", bytes], ["/out", Buffer.from("KEEP")]]);
            ({ stderr, exitCode } = runMagickCliSync(argv, files));
            actual = files.get("/out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", bytes);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { if (mode === "stream") for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            exitCode = result.exitCode;
            actual = await fs.readFile("/out");
        }
        if (fails) expect(stderr).toContain("unexpected end-of-file in GRAYA input");
        else expect(stderr).toBe("");
        expect(exitCode).toBe(fails ? 1 : 0);
        expect(Buffer.from(actual).toString("hex")).toBe(output);
    });
}
