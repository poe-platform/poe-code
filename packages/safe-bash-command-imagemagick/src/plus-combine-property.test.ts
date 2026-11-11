import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { property: "option:name", value: "Gray", colorspace: "%[option:name]" },
    { property: "option:name", value: "Gray", colorspace: "%[name]" },
    { property: "name", value: "Gray", colorspace: "%[name]" },
    { property: "option:name", value: "Gray", colorspace: "Gray" },
    { property: "option:name", value: "not-a-colorspace", colorspace: "%[option:name]" },
])(`${mode}: +combine expands $colorspace ($property=$value)`, async ({ property, value, colorspace }) => {
    const fs = new MemoryFileSystem();
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]);
    await fs.writeFile("/out", keep);
    const args = ["xc:#124578", "-set", property, value, "+combine", colorspace,
        "-set", property, "RGB", "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    if (value === "not-a-colorspace") {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("unrecognized colorspace 'not-a-colorspace'");
        expect(bytes).toEqual(keep);
        return;
    }
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    // Native ImageMagick 7.1.2-35 Q16-HDRI, opaque input isolates property expansion.
    expect(Buffer.from(bytes).toString("hex")).toBe("3e3e3eff");
});
