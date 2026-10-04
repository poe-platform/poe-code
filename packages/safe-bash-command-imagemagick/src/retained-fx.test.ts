import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const expressions = ["u", "1-u", "p{i-1,j+1}", "u.p{w-1-i,h-1-j}.r", "p{p{0,0}.r*w,p{0,0}.g*h}.intensity", "a=p{0,0}.r;b=p{w-1,h-1}.g;a+b+u/2", "u[99].g+rand()", "p{-99,999}.a", "p{sqrt(-1),0}.hue", "(u.hue+u.saturation+u.lightness)/3", "sin(i/w)+cos(j/h)", "if(i<w/2,p{0,0},p{w-1,h-1})", "a=0;a=a+0.25;a+u", "u[-1].intensity"];
const operators = ["RGB", "RGBA", "B"].flatMap(channel => expressions.map(expression => ["-channel", channel, "-fx", expression]));
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original expression pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    const second = await fixture(7, 11);
    for (const expression of ["(u+v)/2", "u[1].p{w-i,h-j}.g+u[0].p{i-1,j+1}.r"]) {
        const files = new Map([["input", bytes], ["second", second]]);
        expect((await runConvertCli(["input", "second", "-fx", expression, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "8cbffaae450e14948f2f33e7856abf377d5ea4337531e5e9034f2f8669771bed",
        "2b7fafd2118ba8ebde164ab9348cb560c966dff7d7d76d2ec5d2ef70b1110232",
        "b5c9984366ca523f3fbd506bcd692089d37315b1c671d2a1f241cad75752521e",
        "ac93ade322d8cf068d10e70ed5172c1d0d555a0d5243176f4760b52ea34f1e9b",
        "73eec4881fb405cb2e38f6d5304b47e8ada022098b2a3dd6cf0b063797439f4a",
        "2b69b9d709e608a78604a0b6a386db5e651258579b428ec3a42a6547d3967ca8",
        "945bca030305710ee6d8d4cc0f0f75fddad2042a4ad6270cedd477f221628cb6",
        "dac2cd092dddeb7247fa9f31a5a354f70845878daea1ff36abcf8d4fabd7c1c7",
        "36bbb7605832353ae731b380341b99b506d6cd10f4a39ddfc7bb687ba4fb3095",
        "3b58b98d9b4651e2630c4e3e184a5442cc515619529171814801fe2f6adf4d7e",
        "d3d1d66ac2b6d0b07b868b8f2db399ecbb3234b4ecd3e4b6e4bcbe3ad9d59a74",
        "b9debe5bc89c5693fb2318d8fbf906b812991a7310cab3bc9a972a95a10ae035",
        "3cc3e81bf95f68f512682448b670f00e5f344d70795cb56f593bb7388e21f3fd",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "aaa52334aaf5caeb1d46cf43fceabd44d420f205e701ed9b7194f654171ba43c",
        "92be97472de21cb3430ef8b93c94eb21e80662c2f35828b118eff135d60dafe5",
        "a4273e6e9f436c3fcbf3e64c0a2438cf4f1711d788c7fc5e6b2004d4f5691548",
        "5cb73ab41e5d7b029cf688a384271aa20b70cf58b7eb01995856cd6c6d76797c",
        "31cb4aa37526195b3e5e78a24b05edf0a1beae460e5fb146119ce1878602da06",
        "4670f678bb642e9703e8a82e4c65ef4888eed345962f23feca1008fed5f6bb27",
        "28514b2a88748e9ae45beda17adc3dcf3f7777871bf7ef594027dfac649278f6",
        "ca7b57b0337ddb66043616f83445ff97c621411740412836d52093696923359b",
        "dd17b4c7a98355a1228c595c18e643670d020c1bf77f10fedd2bca2104d29958",
        "5be5faefa9cd52aa3ce04a6394ccc865010fcc60992215808b32706a57ac3ac2",
        "71584c5b9c06a3ed21bd9596d3b9ed53e4734e752eaec4e12b2b014444054fe1",
        "54ad5e179a07f1554063e36cd2fbbfe2ff0e85cbc45dad7c3d3f825e8a3d3b51",
        "e3c2ed14d4a7f6fe182c95f270c39923c11d4f264d1f3b197ea3d92ac6f190e7",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "9980f4e2c9c7463302ff165e39c029ce641a6a8b2c095ba3413659ff9f53ada1",
        "4a09ba5d57989f4476488f7557fa0cb905fe703161d75a34557319e02e0f6189",
        "bfcc6545a21352059036013e1dab3f3b977ccfa8659e3838da30f0006849c772",
        "40a739d9c9b01a454b0503d846b98374f0cb696cfe0e05317dc6a5a7d7ab5587",
        "00a8bebaefb13185498c9c8c91a7c1acd5c6311d1340c34f73bb94c4093e59ee",
        "1193da6ab024d5e413238f3904ad1dc02a32dae54982f8f83321b9e73c0db326",
        "00a59e47f2c882cd8d2387b8bdf94eb93d2818d324d853228d040d6460f7f444",
        "edb21b452bb4a1f58fdeb3e5d9c77c8cc1ca98b9b418ef9c905d792ab6f5d798",
        "32a761b8ebcf2498775066156b8761c6d97a51adef0334a743cb65402540441b",
        "8408f8830dc1dd176e6a1b9230c9722188081921c86af79478dba5baa98d9a4c",
        "4f69aa38af07940060b1b04a732dbffc4fe65aed0dd90e69c7430191fe87c816",
        "a66a4d8b34b0629b0c29a957f4e63a2c96b86e058bf2ae68fe54d339dda14e55",
        "c5b1aeecca47dd3f3d2971f820679e162efdee8146d63c99f1eb91a47396ef3f",
        "58ac85c6ee52ec9f9fc7101172f6811f3aff65462b2a89fffd7202babf89746b",
        "4843ce0ba2036c1e14daad4f7c6b973f3fa2305163c5ffd591cdbe9073ed97fa",
      ]
    `);
});
it.each(operators.flatMap(args => [[13, 17], [1031, 3], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file expression I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
