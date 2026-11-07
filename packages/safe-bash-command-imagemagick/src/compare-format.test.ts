import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

for (const mode of ["sync", "memory", "retained"] as const) {
    for (const identical of [false, true]) {
        it(`formats distortion without changing metrics or files, ${mode}, identical=${identical}`, async () => {
            const a = await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 160, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const b = identical ? a : await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 240, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["a.png", a], ["b.png", b]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const run = (args: string[]) => mode === "sync" ? runCompareCliSync(args, files) : runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const control = await run(["a.png", "b.png", "control.png"]);
            const formatted = await run(["-format", "%f %wx%h %[distortion]\\n", "a.png", "b.png", "formatted.png"]);
            const expected = identical ? "0" : "0.110919";
            expect(formatted).toEqual({ exitCode: identical ? 0 : 1, stdout: `a.png 2x1 ${expected}\n`, stderr: identical ? "0 (0)\n" : "7269.06 (0.110919)\n" });
            expect(control).toEqual({ ...formatted, stdout: "" });
            const read = (name: string) => mode === "retained" ? filesystem.readFile(`/${name}`) : files.get(name)!;
            expect(decodeImage(await read("formatted.png"))).toEqual(decodeImage(await read("control.png")));
            expect(await run(["-format", "%[distortion]", "a.png", "b.png", "null:"])).toEqual({ ...formatted, stdout: expected });
            expect(await read("a.png")).toEqual(a);
            expect(await read("b.png")).toEqual(b);
        });
    }
}
it("rejects a missing compare format argument", async () => {
    expect(await runCompareCli(["-format"], new Map())).toEqual({ exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-format'\n" });
});

for (const magick of [false, true]) {
    for (const output of ["null:", "png:-"]) {
        it(`streams formatted output after image output, magick=${magick}, output=${output}`, async () => {
            const filesystem = new MemoryFileSystem();
            const bytes = await sharp({ create: { width: 2, height: 1, channels: 4, background: "red" } }).png().toBuffer();
            await filesystem.writeFile("/a.png", bytes);
            const command = magick ? createMagickCommand() : createCompareCommand();
            const args = createCommandArguments([...(magick ? ["compare"] : []), "-metric", "AE", "-format", "distortion=%[distortion]", "a.png", "a.png", output]);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            expect(result).toEqual({ exitCode: 0 });
            expect(stderr).toBe("0 (0)\n");
            expect(new TextDecoder().decode(chunks.at(-1))).toBe("distortion=0");
            if (output === "png:-") {
                const image = Buffer.concat(chunks.slice(0, -1));
                expect(decodeImage(image).width).toBe(2);
            } else expect(chunks).toHaveLength(1);
        });
    }
}
