import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n9 9\n255\n"), Buffer.from(Array.from({ length: 243 }, (_, i) => (i * 71 + 13) % 256))]);
// Complete RGB outputs from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    {
        "option": "-adaptive-sharpen",
        "geometry": "2x1",
        "expected": "0d549bff0064d9ff2598f50055b6ff1a71e20b5299e0276ecdff1faeff0045c0ff0061fc0016b1ff0052edff07a2ff0043beff0055f0001eb9ff0050ebff05a0ff0041bcff005df80012adff004edfff00a8ff003fbaff005bf60010abff004cd7ff0182ff002db8ff004fea0018b3ff004ad5ff0080ff002bb6ff0057f2ff0ca7ff0048d9ff0078ff0029b4ff0055f0ff0aa5ff0046c1ff0062fd0017b2ff0049e4ff12adff0044bfff0060fb0015b0ff0051ecff06a1ff0042d3ff0048ff0013aeff004feaff049fff0040bbff005cf70011acff0043def53c83e6004aabff0f68db002b9cff0057c8f33a81c80f56b0ff03"
    },
    {
        "option": "-sharpen",
        "geometry": "2x1",
        "expected": "003eb4ff0068d9ff2598f50057b4ff1673e60032a5ff0062cdff1fafff0049c0ff0063fd0015afff0054eeff06a0ff0043baff0054f4001fb8ff0056e7ff099cff0045b8ff0061f40016a9ff0050ddff00a7ff0045b8ff005ff20014a7ff0050d5ff0582ff0032b2ff0050e90019b2ff0050d3ff0380fd002db2ff005beeff10a3ff004ad2ff007bff002ab2ff0059ecff0ea1ff004abdff0066f9001facff004ae3ff13acff004abbff0064f70019acff0055e8ff0a9dff0044ccff0049ff000eaeff0051ebff039dff0042b9ff005ef80014a8ff0042e2ff249ae3004ea9ff0b68db00279aff0059ccff188be90048aaff05"
    },
    {
        "option": "-adaptive-sharpen",
        "geometry": "0x1",
        "expected": "0d549bff0068daff2499f60057b4ff1a71e20b5299ff0062cdff1eafff0049c0ff0063fe0015afff0054eeff06a2ff0043beff0054f4001fb8ff0056e7ff099cff0045b8ff0061f40016a9ff004eddff00a8ff0045b8ff005ff20014a7ff0050d5ff0582ff002db8ff0050e90018b3ff0050d3ff0380fd002db2ff005beeff10a3ff0048d2ff007bff002ab2ff0059edff0ea1ff004abdff0066f90017b2ff004ae3ff13acff004abbff0064f70019acff0055e8ff0a9dff0042ccff0049ff000eaeff0051ebff039dff0042b9ff005ef80011acff0042e2ff2899e6004aa9ff0a67dc00279aff0057c8ff1c8de40048abff05"
    },
    {
        "option": "-adaptive-sharpen",
        "geometry": "1x0.5",
        "expected": "0d549be22970c0ff3d93dc035bafff367dc40b5299e0276ebbff389ae50052b3ff347bc2095097de256cc4ff3095e00050b1ff3279c0074e95dc236ac2ff2e93de004eafff3077be054c93da2168bdff2994df004cadff2e75bc034a91d81f66bcff2a82da00579ee52c73ba01488fd61d64baff2880d800559ce32a71b8ff468dd41b62b7ff237fd900539ae1286fb6fd448bd21960b4ff246fd4005198df266db4fb4289d0175eb2ff226dd2004f96dd246bb2f94087ce155cb1ff1d6ad3004d94db2269b0f73e85cc135aaeff1e69ce004b92d92067aef53c83ca1158a5fd246dc3004990d71e65acf33a81c80f56a2f820"
    },
    {
        "option": "-adaptive-sharpen",
        "geometry": "2x0",
        "expected": "0d549be22970b7fe458cd31a61a8ef367dc40b5299e0276eb5fc438ad1185fa6ed347bc2095097de256cb3fa4188cf165da4eb3279c0074e95dc236ab1f83f86cd145ba2e93077be054c93da2168aff63d84cb1259a0e72e75bc034a91d81f66adf43b82c910579ee52c73ba01488fd61d64abf23980c70e559ce32a71b8ff468dd41b62a9f0377ec50c539ae1286fb6fd448bd21960a7ee357cc30a5198df266db4fb4289d0175ea5ec337ac1084f96dd246bb2f94087ce155ca3ea3178bf064d94db2269b0f73e85cc135aa1e82f76bd044b92d92067aef53c83ca11589fe62d74bb024990d71e65acf33a81c80f569de42b"
    }
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each(cases)(`matches native $option $geometry (${mode})`, async ({ option, geometry, expected }) => {
    const files = new Map([["/image.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/image.ppm", input);
    const args = ["/image.ppm", option, geometry, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out.rgb"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O is forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } }),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

for (const mode of ["sync", "retained"] as const)
it.each(["bad", "", "2x1junk", "5000x1"])(`rejects invalid adaptive sharpening without replacing output (${mode}, %j)`, async geometry => {
    const previous = new TextEncoder().encode("keep this output");
    const files = new Map<string, Uint8Array>([["/image.ppm", input], ["/out.rgb", previous]]), fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(name, bytes);
    const args = ["/image.ppm", "-adaptive-sharpen", geometry, "rgb:/out.rgb"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
    expect(result.exitCode).not.toBe(0);
    expect(mode === "sync" ? files.get("/out.rgb") : await fs.readFile("/out.rgb")).toEqual(previous);
});
