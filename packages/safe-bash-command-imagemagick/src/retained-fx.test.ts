import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const expressions = ["u", "1-u", "p{i-1,j+1}", "u.p{w-1-i,h-1-j}.r", "p{p{0,0}.r*w,p{0,0}.g*h}.intensity", "a=p{0,0}.r;b=p{w-1,h-1}.g;a+b+u/2", "u[0].g+rand()", "p{-99,999}.a", "p{sqrt(-1),0}.hue", "(u.hue+u.saturation+u.lightness)/3", "sin(i/w)+cos(j/h)", "if(i<w/2,p{0,0},p{w-1,h-1})", "a=0;a=a+0.25;a+u", "u[-1].intensity"];
const operators = ["RGB", "RGBA", "B"].flatMap(channel => expressions.map(expression => ["-channel", channel, "-fx", expression]));
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original expression pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    const second = await fixture(7, 11);
    for (const expression of ["(u+v)/2", "u[1].p{w-i,h-j}.g+u[0].p{i-1,j+1}.r"]) {
        const files = new Map([["input", bytes], ["second", second]]);
        expect((await runConvertCli(["input", "second", "-fx", expression, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "f9d5f57acdced6d354cbdbc79a353ad730cf02cd3fd9ae7e4464dc46d2803b53",
        "cf2ebcf11825aa97f53f45a7249052dd77e94432c096ae4d51c243b63ecb0294",
        "983628420546de23d4ced119e1fe5283eaabd819a1cebf0ca21ca04293689475",
        "37975e05c74463e89b142cc4b744d2917a93c180901f7d469ed7bfef7b45892c",
        "eaf996352222599e9adb5ab222f091490dbbf1da7a4f2ef4e8f39300324a58b8",
        "aa49d05d6e723b77e3d6b1891ed2e16dd7beeaf588d71658fbb70573752d29f9",
        "cfb6a687cfe66e9b58e3827ad61818ad3545dfdadc864e64e6fc56249d277cff",
        "5524c431dfea8eecb43a01b8d7c7dbef02b9821523d13cf4be70b90785aef537",
        "7df7a311e9520f50db299f7b43192f54009403d8cb60d3af548268dc1fd56820",
        "cd3e0f33def5bf3da49b41fb2b4b0bf611b1543116e4206bf4c930fdac8084b0",
        "6c5b374a33ee657d94b3dd2698005f9f5ca9f22e2c0141882e52ecb140d43fdb",
        "fd56417a3b47b06f50b5c93b3d313ee18bbb10ddd5ed5fbd17de3776b3cdbe6a",
        "743977c9723e3fe45f5e5f67525c388f6f692e8824ae041c86b4be3d4ca165f3",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "0591c87abd0afad58a78ce4cca618895cb7dd018271d3d9d662d958710bdd0b5",
        "5ce80c9e4016d0be2e099156d05858ac01dd4bc49db332de1ec7792c6ca0c2ae",
        "7c122bc8bdab031a74278287ea7a2dbe359f90d99c8dfa73e60188e4c45cf059",
        "a9760b775722266745d8cf3ad5e266a2ab4967bdf3e3aba1e4ae4c144579db4a",
        "414d5e90316277571dd306f3ae829cec7eb70c79234a2f9633e617e1905487db",
        "cc46c1978ed28825ff0ce23b24e5d1968d8e74b8c91a034b54bd4691f94520ec",
        "a3f3a439f828e2d1090e26b4f999b66b32d22a578d03fa6eb6ab96935ab8b23b",
        "1ce7d1c26bb75aa0509e0e6ffa50e7d2f231054f962bb49bf940eff7d7433c88",
        "0995970f948a5f2e7536a557ecf2d7b16aceeda90b3d1f3485c7db50e23760fd",
        "12c07971ffe9443594f95ccfa1ec50acbf90bc26285e71d214020afd87a4f506",
        "e4b0133213c7f36d743e1c583416bdb610823df2314d333e993da2ebb8580e0f",
        "909ba4d95f52246c3b6a380e68a991359e642c1a60eb9ec2aa3b25609602f82d",
        "7a76e6ec2fda5e5af5d47ddaa7b96124c6d06ef9880727aadeead580c6664939",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "88696807fd7e0b2bb045e589312a265b243090b97c1b7a2cc281eb2c2f00d6b9",
        "68bb237ad481823c22ad4607bba7cac5e175131ecca002e42f47e7414292df27",
        "651d499f49505b3b2c9f83cf4651fe1e148b8fa1baf0ab6744a5374d70dbd7d5",
        "c1b39083ff988e0ca5eac4faa2fca62913db75dd07bc508104b72febd5e4e0ed",
        "932978768aaf022104e67be91ee3f5aab744f176819bfea5f0cab209bb0aaf07",
        "63bee0520471e4932fa3774e86bf437b8616d3caaed787e50ca2ac36f31bccbc",
        "2aafd547c7b18c3161081ff5f1f42346287c4f1ee1eebbe5109d9707bab78353",
        "69a189502b3717df440c4615d3c55e2a5700ab0d749dd761331ebd8fdda18eb7",
        "a22c733c3179d7860d5ae432e289e0e15e9b360ebf2226754fa1a284c792297e",
        "ba4d32f34b7ddf3b810aa47d909688ee64f96aa8d78c589bac4d23da23c8d16b",
        "db8a29ab0f65524ca53bd094b2a0722e1b0327181b6b29e6bc01cc3cf8fa0ba5",
        "d79d0d7d5bdffa0007630eb427088fe5d01261ecfe3e2fd6be4dd6c4ca2b492b",
        "7c2073cc4f651043d890150ade1e8425ebeef9b233dd0dbf2034025c3260a633",
        "8cd1842b840446dc3af104ccc31e18dd3ef0813f1a015e162ec525930a5d1991",
        "abebabf6b16b875e77eb53ba3e150c39d4a4d432911b3abf20e16837530ee0a7",
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
