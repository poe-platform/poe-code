import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
const cases = [
    { name: "vignette RGB", vignette: true, output: ["-colorspace", "sRGB"], sha256: "912bd28e55b2736c9bcd1a6120c0b40e8809e060392b8bb743f88f089fa26c36" },
    { name: "unchanged RGB", vignette: false, output: ["-colorspace", "sRGB"], sha256: "ed1819e3d46a9282d0b51adca94aec8e73bcba1ddd5b432259bc918c0c035db0" },
    { name: "vignette black ink", vignette: true, output: ["-channel", "K", "-separate"], sha256: "75dad6c1b837cd00ae597d374c3fc6c8a2b5905f2fb6f1bced610ec8b487710c" },
    { name: "unchanged black ink", vignette: false, output: ["-channel", "K", "-separate"], sha256: "bdb9cbcf53e496353ec318b0b24dbf23df0a54a32085c9af8c88bbdea79e762a" },
    {name: "black selected", vignette: true, options: ["-channel", "K"], output: [], format: "cmyka", pixels: 24, sha256: "8daf9866947aef32472db081eb649348524fbc1e5dd927c648665e015d1b504e"},
    {name: "color selected", vignette: true, options: ["-channel", "CMY"], output: [], format: "cmyka", pixels: 24, sha256: "63a10705574c5b73cc62b1e9e61ac8936ed1f976a67c1bfac17f4d3b7446fec4"},
    {name: "alpha selected", vignette: true, options: ["-channel", "A"], output: [], format: "cmyka", pixels: 24, sha256: "20ef277670c5a441af57e3c0d3db4219f28dc211158350fa01420d15191d6bfb"},
    {name: "source compose", vignette: true, options: ["-compose", "Src"], output: [], format: "cmyka", pixels: 24, sha256: "e1e5c18a12a681f86c32bea6c6a7fee94864a26aaf365cc6c119906d57216eb5"},
    {name: "destination compose", vignette: true, options: ["-compose", "Dst"], output: [], format: "cmyka", pixels: 24, sha256: "20ef277670c5a441af57e3c0d3db4219f28dc211158350fa01420d15191d6bfb"},
    {name: "transparent background", vignette: true, options: ["-background", "#d2915380"], output: [], format: "cmyka", pixels: 24, sha256: "567d66151000047063119fa89f777e3adc5b0ebaf002bca6c3dc2f080b27b1b9"},
    {name: "virtual canvas", vignette: true, options: ["-repage", "8x6+1+1"], output: [], format: "cmyka", pixels: 48, sha256: "7c99aaed3e44994e932af1515132228a025fbd70c10d69c00e403983110782e4"},
].map(test => ({ options: [] as string[], format: "rgba", pixels: 24, ...test }));

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`${mode}: renders CMYK $name`, async ({ vignette, options, output, format, pixels, sha256 }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const args = ["-size", "6x4", "xc:#3876b4", "-colorspace", "CMYK", "-background", "#d29153",
        ...options, ...(vignette ? ["-vignette", "0x0+1+1"] : []), ...output, "-depth", "8", `${format}:/out`];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(bytes.length).toBe(pixels * (format === "cmyka" ? 5 : 4));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
});
