import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const keep = new TextEncoder().encode("KEEP");
const packed = {
    rgb: "1f364d647b92a9c0d7ee051c",
    rgba: "1f364d647b92a9c0d7ee051c334a6178",
    bgr: "1f364d647b92a9c0d7ee051c",
    graya: "1f364d647b92a9c0",
    cmyka: "1f364d647b92a9c0d7ee051c334a61788fa6bdd4"
};
const planes = {
    R: "1e3c5a78", G: "2a486684", B: "36547290", O: "42607e9c", A: "4e6c8aa8",
    C: "5a7896b4", M: "6684a2c0", Y: "7290aecc", K: "7e9cbad8"
};

for (const mode of ["command", "sync"] as const) {
    async function execute(argv: string[], files: Map<string, Uint8Array>) {
        if (mode === "sync") return { ...runMagickCliSync(argv, files), read: async (path: string) => files.get(path)! };
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stderr, read: (path: string) => fs.readFile(path) };
    }

    it.each([
        ["rgba", "Partition", "1e2a36003c4854005a66720078849000"],
        ["bgr", "Partition", "002a72ff004890ff006672ff008490ff"],
        ["graya", "Partition", "2a2a2a00484848006666660084848400"],
        ["cmyka", "Partition", "534d470034302b001c1916000b0a0800"],
        ["rgb", "Partition", "1e2a36ff3c4854ff5a6672ff788490ff"],
        ["rgba", "None", packed.rgba],
        ["cmyka", "None", "887a6c7b110d0aeeb1a19161231d17d4"]
    ] as const)(`reads native %s %s samples when base and channel files disagree (${mode})`, async (format, interlace, hex) => {
        const files = new Map<string, Uint8Array>([["/out", keep], ["/in.data", Buffer.from(packed[format], "hex")]]);
        for (const [channel, samples] of Object.entries(planes)) files.set(`/in.${channel}`, Buffer.from(samples, "hex"));
        const result = await execute(["-size", "2x2", "-depth", "8", "-interlace", interlace, `${format}:/in.data`, "-interlace", "None", "-depth", "8", "rgba:/out"], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(await result.read("/out")).toString("hex")).toBe(hex);
        expect(Buffer.from(await result.read("/in.data")).toString("hex")).toBe(packed[format]);
        for (const [channel, samples] of Object.entries(planes)) expect(Buffer.from(await result.read(`/in.${channel}`)).toString("hex")).toBe(samples);
    });

    it.each([
        ["rgba", "1e2a36003c4854005a66720078849000"],
        ["rgbo", "1e2a36003c4854005a66720078849000"],
        ["bgr", "002a72ff004890ff006672ff008490ff"],
        ["bgra", "002a7200004890000066720000849000"],
        ["bgro", "002a7200004890000066720000849000"],
        ["gray", "2a2a2aff484848ff666666ff848484ff"],
        ["graya", "2a2a2a00484848006666660084848400"],
        ["cmyk", "534d47ff34302bff1c1916ff0b0a08ff"],
        ["cmyka", "534d470034302b001c1916000b0a0800"]
    ].flatMap(([format, hex]) => [8, 16].flatMap(depth => ["MSB", "LSB"].map(endian => ({ format: format!, hex: hex!, depth, endian })))))(`reads $format $depth-bit $endian partitions without a base file (${mode})`, async ({ format, hex, depth, endian }) => {
        const files = new Map<string, Uint8Array>();
        for (const [channel, samples] of Object.entries(planes)) {
            const values = Buffer.from(samples, "hex");
            // Distinct bytes test byte order as well as 16-bit sample widths.
            files.set(`/multi.name.${channel}`, depth === 8 ? values : Buffer.from([...values].flatMap(value => endian === "MSB" ? [value, value - 1] : [value - 1, value])));
        }
        const result = await execute(["-size", "2x2", "-depth", String(depth), "-endian", endian, "-interlace", "Partition", `/multi.name.${format}`, "+interlace", "-depth", "8", "rgba:/out"], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        // Conversion to RGBA8 rounds these samples to the same 8-bit values.
        expect(Buffer.from(await result.read("/out")).toString("hex")).toBe(hex);
    });

    it.each([
        ["rgba", "RGBA"], ["rgbo", "RGBA"], ["bgr", "BGR"], ["bgra", "BGRA"], ["bgro", "BGRA"],
        ["gray", "G"], ["graya", "GA"], ["cmyk", "CMYK"], ["cmyka", "CMYKA"]
    ].flatMap(([format, channels]) => [...channels!].flatMap(channel => ["missing", "short"].map(fault => ({ format: format!, channel, fault })))))(`preserves output with $fault $format .$channel partition (${mode})`, async ({ format, channel, fault }) => {
        const files = new Map<string, Uint8Array>([["/out", keep], ["/in.data", new Uint8Array(20)]]);
        for (const [name, samples] of Object.entries(planes)) files.set(`/in.${name}`, Buffer.from(samples, "hex"));
        if (fault === "missing") files.delete(`/in.${channel}`);
        else files.set(`/in.${channel}`, new Uint8Array(3));
        const result = await execute(["-size", "2x2", "-depth", "8", "-interlace", "Partition", `${format}:/in.data`, "+interlace", "rgba:/out"], files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).not.toBe("");
        expect(await result.read("/out")).toEqual(keep);
    });

}
