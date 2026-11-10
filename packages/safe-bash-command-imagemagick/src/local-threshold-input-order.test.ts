import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input", "no lat"])(`requires an image at lat (%s, ${mode})`, async placement => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const inputs = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append"];
        const args = placement === "before input" ? ["-lat", "3x1", ...inputs]
            : placement === "after delete" ? ["xc:red", "+delete", "-lat", "3x1", ...inputs]
            : placement === "after input" ? [...inputs, "-set", "option:win", "3x1", "-lat", "3x1"] : inputs;
        args.push("-depth", "8", "rgba:/out");
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        const empty = placement === "before input" || placement === "after delete";
        expect.soft(result.exitCode).toBe(empty ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(empty ? "magick: no images found for operation '-lat'\n" : "");
        // Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 controls.
        expect(Buffer.from(output).toString("hex")).toBe(empty ? "4b454550"
            : placement === "after input" ? "00ffff00ff0000ffffffffff" : "20709040804020a0a070a0ee");
    });
}

it("rejects lat before consuming later stdin or overwriting the destination", async () => {
    const filesystem = new MemoryFileSystem();
    const keep = new TextEncoder().encode("KEEP");
    await filesystem.writeFile("/out", keep);
    let consumed = false, stderr = "";
    const argumentValues = createCommandArguments(["-lat", "3x1", "ppm:-", "-depth", "8", "rgba:/out"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal,
        stdin: (async function* () {
            consumed = true;
            yield new TextEncoder().encode("P3\n1 1\n255\n32 112 144\n");
        })(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect.soft(result.exitCode).toBe(1);
    expect.soft(stderr).toBe("magick: no images found for operation '-lat'\n");
    expect.soft(consumed).toBe(false);
    expect(await filesystem.readFile("/out")).toEqual(keep);
});
