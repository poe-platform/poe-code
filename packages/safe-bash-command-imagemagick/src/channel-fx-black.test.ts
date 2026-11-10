import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { cmyk: true, expression: "black", expected: "00000080c0" },
        { cmyk: true, expression: "k", expected: "00000080c0" },
        { cmyk: true, expression: "3", expected: "00000080c0" },
        { cmyk: true, expression: "k=>r", expected: "7f80007fc0" },
        { cmyk: true, expression: "r=>k", expected: "bf8000bfc0" },
        { cmyk: true, expression: "a=>k", expected: "bf8000c0c0" },
        { cmyk: true, expression: "k=>a", expected: "bf80007f7f" },
        { cmyk: true, expression: "k<=>a", expected: "bf8000c07f" },
        { cmyk: true, expression: "black=50%", expected: "bf800080c0" },
        { cmyk: true, expression: "r=>g", expected: "bfbf007fc0" },
        { cmyk: true, expression: "r", expected: "00000040c0" },
        { cmyk: true, expression: undefined, expected: "bf80007fc0" },
        { cmyk: true, expression: "black", color: "#123456789abcdef0", depth: 16, expected: "0000000000009abcdef0" },
        { cmyk: true, expression: "k=>r", color: "#123456789abcdef0", depth: 16, expected: "654370f100006543def0" },
        { cmyk: true, expression: "r=>k", color: "#123456789abcdef0", depth: 16, expected: "e1e170f10000e1e1def0" },
        { cmyk: false, expression: "r=>k", expected: "204080c0" },
        { cmyk: false, expression: "r=>g", expected: "202080c0" },
    ])(`keeps black ink separate from alpha in ${mode}, cmyk=$cmyk: $expression`, async ({ cmyk, expression, expected, color = "#204080c0", depth = 8 }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including the issue controls.
        const fs = new MemoryFileSystem();
        const argv = [`xc:${color}`, ...(cmyk ? ["-colorspace", "CMYK"] : []), ...(expression ? ["-channel-fx", expression] : []), "-depth", String(depth), "-endian", "MSB", cmyk ? "cmyka:-" : "rgba:-"];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
        }
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["black", "k=>r", "black=50%"])(`rejects a missing black source without replacing output in ${mode}: %s`, async expression => {
        const original = new Uint8Array([1, 2, 3]), files = new Map([["/out.rgba", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.rgba", original);
        const argv = ["xc:#204080c0", "-channel-fx", expression, "-depth", "8", "rgba:/out.rgba"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("missing image channel");
        expect(mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")).toEqual(original);
    });
}

it.each(["black", "r=>k"])("preserves black and alpha across retained chunks: %s", async expression => {
    const filesystem = new MemoryFileSystem();
    const result = await runMagickCli(["-size", "4097x1", "xc:#204080c0", "-colorspace", "CMYK", "-channel-fx", expression, "-depth", "8", "cmyka:/out.raw"], { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.raw");
    const expected = Buffer.from(expression === "black" ? "00000080c0" : "bf8000bfc0", "hex");
    expect(output).toEqual(new Uint8Array(Buffer.concat(Array.from({ length: 4097 }, () => expected))));
});
