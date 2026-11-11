import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./mpc-fixtures.json" with { type: "json" };
import { withImageInputs } from "./image-input.js";

// Unmodified native ImageMagick 7.1.2-35 Q16-HDRI x86_64 output:
// magick xc:red xc:blue +append -set label tile native.mpc (and control.miff)
// magick xc:red xc:blue frames.mpc
// Expected metadata and pixels were read back with that same native binary.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function run(args: string[], omit?: string, truncate?: string) {
        const files = new Map(Object.entries(fixtures).filter(([name]) => name !== omit)
            .map(([name, value]) => [`images/${name}`, Buffer.from(value, "base64").subarray(0, name === truncate ? 1 : undefined)]));
        if (mode === "sync") return runMagickCliSync(args, files);
        if (mode === "buffered") return runMagickCli(args, files);
        const filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/images");
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        if (mode === "retained") return runMagickCli(args, { filesystem, cwd: "/" });
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        const stdoutBytes = Buffer.concat(chunks);
        return { ...result, stdoutBytes, stdout: stdoutBytes.toString(), stderr };
    }
    it.each(["native.mpc", "control.miff"])(`${mode}: reads native %s dimensions and label`, async name => {
        expect(await run([`images/${name}`, "-format", "%wx%h:%[label]", "info:"]))
            .toMatchObject({ exitCode: 0, stdout: "2x1:tile", stderr: "" });
    });
    it.each([
        ["native.mpc", "ff00000000ff"], ["control.miff", "ff00000000ff"],
        ["frames.mpc", "ff00000000ff"], ["frames.mpc[1]", "0000ff"],
        ["frames.mpc[1,0]", "0000ffff0000"]
    ])(`${mode}: reads native %s RGB pixels`, async (name, hex) => {
        const result = await run([`images/${name}`, "-depth", "8", "rgb:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(hex);
    });
    it(`${mode}: reads all native frame dimensions and scene numbers`, async () => {
        expect(await run(["images/frames.mpc", "-format", "%s:%wx%h;", "info:"]))
            .toMatchObject({ exitCode: 0, stdout: "0:1x1;1:1x1;", stderr: "" });
    });
    it.each(["missing", "truncated"])(`${mode}: rejects a %s companion cache`, async failure => {
        const pending = run(["images/native.mpc", "-depth", "8", "rgb:-"],
            failure === "missing" ? "native.cache" : undefined, failure === "truncated" ? "native.cache" : undefined);
        if (mode === "command" || mode === "retained") {
            await expect(pending).rejects.toThrow(failure === "missing" ? "cache" : "Truncated MPC");
            return;
        }
        const result = await pending;
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(failure === "missing" ? "cache" : "Truncated MPC");
    });
}

it("charges the native descriptor and cache to the same input budget", async () => {
    const filesystem = new MemoryFileSystem();
    const descriptor = Buffer.from(fixtures["native.mpc"], "base64"), cache = Buffer.from(fixtures["native.cache"], "base64");
    await filesystem.writeFile("/native.mpc", descriptor);
    await filesystem.writeFile("/native.cache", cache);
    const charges: number[] = [];
    await withImageInputs({ filesystem, cwd: "/", inputBudget: { check(bytes) { charges.push(bytes); } } }, undefined,
        new AbortController().signal, async read => {
            await read("native.mpc", async source => {
                // A partial, unaligned read across two native float samples.
                const bytes = await source.read(source.size - 7, 7);
                expect(Buffer.from(bytes).toString("hex")).toBe("0000003f800000");
            });
        });
    expect(charges).toEqual([descriptor.length, descriptor.length + cache.length]);
    await expect(withImageInputs({ filesystem, cwd: "/", inputBudget: { check(bytes) {
        if (bytes > descriptor.length + cache.length - 1) throw new Error("input byte limit");
    } } }, undefined, new AbortController().signal, read => read("native.mpc", async () => {
        throw new Error("consumer must not run after the budget is exceeded");
    }))).rejects.toThrow("input byte limit");
    expect(await filesystem.readFile("/native.mpc")).toEqual(new Uint8Array(descriptor));
    expect(await filesystem.readFile("/native.cache")).toEqual(new Uint8Array(cache));
});
