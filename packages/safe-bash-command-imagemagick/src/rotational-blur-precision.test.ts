import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDU6MzYrMDA6MDDZwku5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ1OjM2KzAwOjAwqJ/zBQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0NTozNiswMDowMP+K0toAAACXSURBVBjTXcohD0FhGMXxd49iNkEQTLMbXaYYm0i4URUkX0H2HUTfwURFd6OhsQmCs4nslv9myr3buzedc57nV3LduTtc30k8uX+t0Us/ldbw+Mh2g9OrU41Gl189HpukJbCXJIA8Z5LOxba8tAEXwJqkJoB5jyeQBDCVtDDvgKQNsA7gyiRtAzgFbj40oC8pC2AZiIr9B68y0SJ6hpAJAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -rotational-blur 38 ...args PNG32:out.png,
// decoded with out.png -depth 8 rgba:-. No intermediate image is saved between operators.
const cases = [
    {
        "name": "single",
        "args": [],
        "rgba": "d7683536cc8342485180af473a6998902d5c8b823564933c6998c7554e7dac9f376695c0de403c6798c7f6135685b42571608f8ab3666d90e2a24050000000006190bf6f2e5d8cb4dd543b5a9dccfb1e5685b4392a5988b7f9285786b5e413426f9ecd474a79a87b2352817bd2a9305d99c8f7225483b2a900000000e1103f6eb0df0e3d6b9ac9be3261908875316051c6f52a3e8ebdec144d7cabd90d3c6b9a0000000098c7f6256392c1ef295887b5b729585ec6f524183e6d9c404e6190a133626d906a99434e6e9d884b4978a7b7204f7e7c981f4e7aa9d80717346392376d518079985e6382d6833c47b6e53719225180334927565c8a174671"
    },
    {
        "name": "threshold",
        "args": [
            "-threshold",
            "46%"
        ],
        "rgba": "ffffffffffffffffffffffff000000000000000000000000ffffffffffffffff0000000000000000ffffffffffffffff00000000ffffffffffffffff00000000ffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff000000000000000000000000ffffffffffffffff0000000000000000ffffffff000000000000000000000000ffffffffffffffff000000000000000000000000ffffffff000000000000000000000000ffffffffffffffff000000000000000000000000"
    },
    {
        "name": "second blur",
        "args": [
            "-rotational-blur",
            "38"
        ],
        "rgba": "d7603b49b36a5b504a79a84d3a69987733629172406f9e575b8ab9554776a5903a6998b3d9553d5a72a1d0255180af3384658772a86e6f7ecc85554c4372a11a5b8ab96b3564939ed7703e539bcaf91c5584b3502a5988b7f9285786b5e413426d9ccb534978a77b3e568575d39f325398c7f61d5281b09900000000e1103f6eb0df0e3d6998c7ac356493916a3b6a60b8c43c426998c7254f78a7bf0d3c6b9a0000000098c7f6255f8ebdd52958879887305f6291c04e2c5d6695445a638c89446a72845685615e5d8c89674675a0a1245382778c24536a76a5512062687d41745a7a6b9661656fb47a4f4b948a512e31607740622b5a597f1e4d6e"
    },
    {
        "name": "zero angle",
        "args": [
            "-rotational-blur",
            "0",
            "-threshold",
            "46%"
        ],
        "rgba": "ffffffffffffffffffffffff000000000000000000000000ffffffffffffffff0000000000000000ffffffffffffffff00000000ffffffffffffffff00000000ffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff000000000000000000000000ffffffffffffffff0000000000000000ffffffff000000000000000000000000ffffffffffffffff000000000000000000000000ffffffff000000000000000000000000ffffffffffffffff000000000000000000000000"
    },
    {
        "name": "masked second blur",
        "args": [
            "-channel",
            "R",
            "-rotational-blur",
            "38",
            "+channel"
        ],
        "rgba": "d7683536b38342484a80af473a699890335c8b824064933c5b98c755477dac9f3a6695c0d9403c6772c7f6135185b42584608f8aa8666d90cca24050430000005b90bf6f355d8cb4d7543b5a9bccfb1e5585b4392a5988b7f9285786b5e413426d9ecd474979a87b3e52817bd3a9305d98c8f7225283b2a900000000e1103f6eb0df0e3d699ac9be356190886a316051b8f52a3e69bdec144f7cabd90d3c6b9a0000000098c7f6255f92c1ef295887b58729585e91f524185d6d9c405a6190a144626d905699434e5d9d884b4678a7b7244f7e7c8c1f4e7a76d807176263923774518079965e6382b4833c4794e53719315180336227565c7f174671"
    }
];

for (const mode of ["buffered", "sync", "retained", "command", "mogrify"] as const)
it.each(cases)(`preserves rotational blur precision through $name (${mode})`, async ({ args: following, rgba }) => {
    const files = new Map([["input.png", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const operations = ["-rotational-blur", "38", ...following];
    const args = ["input.png", ...operations, "PNG32:out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : mode === "mogrify" ? await runMogrifyCli([...operations, "input.png"], { filesystem: fs, cwd: "/" })
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "sync" || mode === "buffered" ? files.get("out.png")!
        : await fs.readFile(mode === "mogrify" ? "/input.png" : "/out.png");
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(rgba);
});
