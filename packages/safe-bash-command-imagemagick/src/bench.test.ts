import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each([1, 2, 3])(`executes every benchmark iteration (${mode}, %i)`, async count => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const write = vi.spyOn(filesystem, "publishStagedFile");
        const set = vi.spyOn(files, "set");
        const args = ["-bench", String(count), "-size", "2x1", "xc:red", "-depth", "8", "rgb:/out.raw"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stdout" in result && "stderr" in result) { stdout += result.stdout; stderr += result.stderr; }
        expect(result.exitCode).toBe(0);
        expect(stdout).toBe("");
        expect(stderr).toContain(`Performance[1]: ${count}i `);
        const retained = mode === "public" || mode === "retained";
        expect(retained ? await filesystem.readFile("/out.raw") : files.get("/out.raw")).toEqual(new Uint8Array([255, 0, 0, 255, 0, 0]));
        expect((retained ? write.mock.calls.map(([, path]) => path) : set.mock.calls.map(([path]) => path)).filter(path => path === "/out.raw")).toHaveLength(count);
    });
}

it("does not report performance without -bench", async () => {
    const result = await runMagickCli(["-size", "2x1", "xc:red", "-depth", "8", "rgb:out.raw"], new Map());
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
});

it.each(["0", "-1", "1.5", "Infinity", "bad", "9007199254740992"])("rejects nonpositive or nonfinite benchmark count %s", async count => {
    const files = new Map<string, Uint8Array>();
    const result = await runMagickCli(["-bench", count, "xc:red", "rgb:out.raw"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-bench'");
    expect(files.size).toBe(0);
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`preserves repeated stdout (${mode})`, async () => {
        const args = ["-bench", "2", "-size", "2x1", "xc:red", "-depth", "8", "rgb:-"];
        const result = mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stdoutBytes).toEqual(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]));
    });
}

it("stops on a failed conversion", async () => {
    const result = await runMagickCli(["-bench", "3", "missing.png", "out.png"], new Map());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Performance[1]: 1i ");
});

it("honors cancellation between iterations", async () => {
    const controller = new AbortController();
    const filesystem = new MemoryFileSystem();
    let writes = 0;
    await expect(runMagickCli(["-bench", "3", "xc:red", "-format", "%w", "info:-"], {
        filesystem, cwd: "/", stdout: { async write() { writes++; controller.abort(); } }
    }, undefined, controller.signal)).rejects.toThrow();
    expect(writes).toBe(1);
});

it("streams the benchmark report to a supplied stderr sink", async () => {
    let stderr = "";
    const result = await runMagickCli(["-bench", "2", "xc:red", "null:"], {
        filesystem: new MemoryFileSystem(), cwd: "/",
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(stderr).toContain("Performance[1]: 2i ");
});
