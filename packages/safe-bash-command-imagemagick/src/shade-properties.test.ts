import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from("ff000000ff000000ff40a0209020a0101220", "hex")
]));
// ImageMagick 7.1.2-35 Q16-HDRI, -shade 30x45 -depth 8 rgb:-.
const expected = Uint8Array.from(Buffer.from("787878d7d7d7d9d9d9bbbbbbe0e0e0d0d0d0", "hex"));

for (const options of [
    ["-set", "option:angle", "30x45", "-shade", "%[option:angle]"],
    ["-shade", "%[fx:w*10]x45"],
    ["-resize", "6x4!", "-shade", "%[fx:w*5]x%[fx:h*10+5]", "-resize", "3x2!"]
]) {
    it.each(["public", "buffered", "sync"])(`expands ${options.join(" ")} through %s`, async mode => {
        const fs = new MemoryFileSystem(), files = new Map([["/i.ppm", input]]);
        await fs.writeFile("/i.ppm", input);
        const args = ["/i.ppm", ...options, "-depth", "8", "rgb:/o.rgb"];
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result).toMatchObject({ exitCode: 0 });
        }
        const output = mode === "public" ? await fs.readFile("/o.rgb") : files.get("/o.rgb");
        if (options[0] === "-resize") {
            const literalFiles = new Map([["/i.ppm", input]]);
            expect(runConvertCliSync(["/i.ppm", "-resize", "6x4!", "-shade", "30x45", "-resize", "3x2!", "-depth", "8", "rgb:/o.rgb"], literalFiles).exitCode).toBe(0);
            expect(output).toEqual(literalFiles.get("/o.rgb"));
        } else expect(output).toEqual(expected);
    });
}

it.each(["sync", "stored"])("rejects an invalid expanded angle without replacing output through %s", async mode => {
    const files = new Map([["/i.ppm", input], ["/o.rgb", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/i.ppm", input);
    await fs.writeFile("/o.rgb", input);
    const args = ["/i.ppm", "-set", "option:angle", "bad", "-shade", "%[option:angle]", "rgb:/o.rgb"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
    expect(result.exitCode).not.toBe(0);
    expect(mode === "sync" ? files.get("/o.rgb") : await fs.readFile("/o.rgb")).toEqual(input);
});
