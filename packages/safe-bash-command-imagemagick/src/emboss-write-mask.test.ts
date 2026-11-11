import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: image.ppm [-write-mask mask.pgm] -emboss 2x1 -depth 8 rgb:-.
const cases = [
    { maskKind: "checkerboard", expected: "0000ffe22970ffff008cd31affffff367dc40000ffe0276effff008ad1184f8bff347bc2000087de256cffff0088cf163587ff3279c00000c7dc236affff0086cd14568fff3077be000087da2168ffff0084cb125a92ff2e75bc000087d81f66ffff0082c9100087ff2c73ba0000c7d61d64ffff0080c70e0087ff2a71b8ff0087d41b62ffff007ec50c0087ff286fb6ff0087d219609aff007cc30a0087ff266db4ff00c7d0175e96ff007ac1080087ff246bb2ff0087ce155cffff0078bf06008fff2269b0ff0087cc135aa1ff0076bd040087ff2067aeff0000ca115800ff0074bb020000ff1e65acff0000c80f56ffff00" },
    { maskKind: "none", expected: "0000ffff00ffffff00ffff00ffffff00ffff0000ffff00ffffff0068ff004953ff0053ff000053ff0053ffff0053ff003453ff0000ff000068ff0053ffff0053ff005353ff0053ff000053ff0053ffff0068ff005353ff0053ff000053ff0053ffff0053ff000053ff000aff000068ff0053ffff0053ff000053ff0053ffff0053ff0053ffff0000ff000053ff0053ffff0053ff005353ff0053ff000053ff0000ffff0068ff005353ff0053ff000053ff0053ffff0053ff0049ffff0000ff000053ff0053ffff0053ff005353ff0053ff000053ff0005ffff0000ff000000ff0000ff000000ff0000ffff0000ff0000ffff00" },
    { maskKind: "fractional", expected: "0000ffff00ffffff00c7ff008fceff238cd10000ffff00ffffff0095ff005b9fff0057ff00007aff0057ffff0081ff005ba1ff0011ff0000a1ff005fffff0084ff00467fff0068ff000081ff005ee6ff0086dc044c83ff0066ff000083ff005fd7ff0575ff000081ff003cff00009aff0060b2f93073ff000085ff0065ffff0086ff005fffff0000ff000089ff0066ffff0087d2196085ff006cff000087ff0053ffff238dff004c89ff006eff00008aff0067ebff0075ff0049ffff0000ff00008fff0668c7ff0078ff005191ff0072ff000e8fff000effff0009ff00003fff003edb003e86ef0000ffff0000ff0000b3ff00" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: matches the complete native emboss raster with mask=$maskKind`, async ({ maskKind, expected }) => {
    const input = Uint8Array.from([...new TextEncoder().encode("P6\n9 9\n255\n"), ...Array.from({ length: 243 }, (_, i) => (i * 71 + 13) % 256)]);
    const mask = Uint8Array.from([...new TextEncoder().encode("P5\n9 9\n255\n"), ...Array.from({ length: 81 }, (_, i) => maskKind === "fractional" ? (i * 47) % 256 : 255 * (i % 2))]);
    const files = new Map([["/image.ppm", input], ["/mask.pgm", mask]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/image.ppm", ...(maskKind !== "none" ? ["-write-mask", "/mask.pgm"] : []), "-emboss", "2x1", "-depth", "8", "rgb:/out.rgb"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(output).toHaveLength(243);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
