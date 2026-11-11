import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: unselected channels retain destination samples.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const layers of [false, true])
it.each([
    { settings: ["-channel", "R"], compose: "Src", hex: "e04eaacc" },
    { settings: ["-channel", "Alpha"], compose: "Src", hex: "164eaa88" },
    { settings: ["-channel", "G,B"], compose: "Src", hex: "169b56cc" },
    { settings: ["-channel", "R"], compose: "Over", hex: "8d4eaacc" },
    { settings: [], compose: "Src", hex: "e09b5688" },
    { settings: ["-channel", "R", "+channel"], compose: "Src", hex: "e09b5688" },
])(`${route}, layers=${layers}: $compose with $settings preserves RGBA`, async ({ settings, compose, hex }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:#164eaacc", ...(layers ? ["null:"] : []), "xc:#e09b5688",
        ...settings, "-compose", compose, ...(layers ? ["-layers", "Composite"] : ["-composite"]),
        "-depth", "8", "rgba:/out.raw"];
    let stdout = "", stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : route === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = route === "command" || route === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
