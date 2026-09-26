import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { decryptBiffRecords } from "./biff-encryption.js";
import { writeCfb } from "./biff-write-binary.js";
import { Binary, readBiffRecords, readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
// Original MS-OFFCRYPTO standard RC4 vectors, independently qualified in native Gnumeric.
const fixtures = [
  {"mode":"number","input":"0908100000060500bb0dcc0741000000060000002f003600010001000100000102030405060708090a0b0c0d0e0f75893a71a012720e88b0c355190404ef7952c14f1ebd3eec4903dea40b7cc250e1000200e404420002001ec931001400bc8f9260a77ba3c80f113d8939604b37be98d2a2e00014003825c9d466173528dc98b21e6afd886b183404c0e0001400f9710b65550354ddae9240fd66c64f07715dc812e000140012b7ceb7672023935073fb79c5d8f900aa665171e00014001bb3cb52d5bfbb62168499b71b7074def292ad1fe000140097bc41e72f6c7c244d8c6fb5496034629c64402fe0001400bac49fcdc6fad85aca5401383baf07a0790b71b0e000140091257fc920b42cb667d81ec18635c1b7f1d8af3ce0001400fb1983eeaa9453908cb3aee1e9f3d25a06ce392be00014002b7801bc6bcd87bbe20c77fec03da4f45a74a99be0001400d1f69d3e2952e759a1648e40eb38260b7000adf5e000140023280922d600b48d7efbf989d83580e040a58ae0e0001400b543afc66674f3c3cc8bc87a374915bf185ae98ee0001400c054e3ef7e02b683167e4b418bfff4b72a2284d9e0001400ec2f2d6789e2bab89b94566bbbacac5ecba06ed3e0001400e967f3d4a0e1dfe321eab5cab455328169454ffbe0001400f68a469dfe2cd51ce2fd622a2bb40c28f15682ee85000c0006020000b3955d5ea55c85980a0000000908100000061000bb0dcc07410000000600000003020e0028f0f919ee4c25bbe72b7951cdc30a000000"},
  {"mode":"formula","input":"0908100000060500bb0dcc0741000000060000002f003600010001000100000102030405060708090a0b0c0d0e0f75893a71a012720e88b0c355190404ef7952c14f1ebd3eec4903dea40b7cc250e1000200e404420002001ec931001400bc8f9260a77ba3c80f113d8939604b37be98d2a2e00014003825c9d466173528dc98b21e6afd886b183404c0e0001400f9710b65550354ddae9240fd66c64f07715dc812e000140012b7ceb7672023935073fb79c5d8f900aa665171e00014001bb3cb52d5bfbb62168499b71b7074def292ad1fe000140097bc41e72f6c7c244d8c6fb5496034629c64402fe0001400bac49fcdc6fad85aca5401383baf07a0790b71b0e000140091257fc920b42cb667d81ec18635c1b7f1d8af3ce0001400fb1983eeaa9453908cb3aee1e9f3d25a06ce392be00014002b7801bc6bcd87bbe20c77fec03da4f45a74a99be0001400d1f69d3e2952e759a1648e40eb38260b7000adf5e000140023280922d600b48d7efbf989d83580e040a58ae0e0001400b543afc66674f3c3cc8bc87a374915bf185ae98ee0001400c054e3ef7e02b683167e4b418bfff4b72a2284d9e0001400ec2f2d6789e2bab89b94566bbbacac5ecba06ed3e0001400e967f3d4a0e1dfe321eab5cab455328169454ffbe0001400f68a469dfe2cd51ce2fd622a2bb40c28f15682ee85000c0006020000b3955d5ea55c85980a0000000908100000061000bb0dcc07410000000600000006001d0028f0f919ee4c25bbe72b796907c359847741d691042550fe8420f199ec0a000000"},
  {"mode":"string","input":"0908100000060500bb0dcc0741000000060000002f003600010001000100000102030405060708090a0b0c0d0e0f75893a71a012720e88b0c355190404ef7952c14f1ebd3eec4903dea40b7cc250e1000200e404420002001ec931001400bc8f9260a77ba3c80f113d8939604b37be98d2a2e00014003825c9d466173528dc98b21e6afd886b183404c0e0001400f9710b65550354ddae9240fd66c64f07715dc812e000140012b7ceb7672023935073fb79c5d8f900aa665171e00014001bb3cb52d5bfbb62168499b71b7074def292ad1fe000140097bc41e72f6c7c244d8c6fb5496034629c64402fe0001400bac49fcdc6fad85aca5401383baf07a0790b71b0e000140091257fc920b42cb667d81ec18635c1b7f1d8af3ce0001400fb1983eeaa9453908cb3aee1e9f3d25a06ce392be00014002b7801bc6bcd87bbe20c77fec03da4f45a74a99be0001400d1f69d3e2952e759a1648e40eb38260b7000adf5e000140023280922d600b48d7efbf989d83580e040a58ae0e0001400b543afc66674f3c3cc8bc87a374915bf185ae98ee0001400c054e3ef7e02b683167e4b418bfff4b72a2284d9e0001400ec2f2d6789e2bab89b94566bbbacac5ecba06ed3e0001400e967f3d4a0e1dfe321eab5cab455328169454ffbe0001400f68a469dfe2cd51ce2fd622a2bb40c28f15682ee85000c0006020000b3955d5ea55c85980a0000000908100000061000bb0dcc0741000000060000000402270028f0f919ee4c3bbbe76a1d30a8e237e05720f6fd6c4b29f7f65b93f69dc91d65b8454a649d92d30a000000"},
  {"mode":"sst","input":"0908100000060500bb0dcc0741000000060000002f003600010001000100000102030405060708090a0b0c0d0e0f75893a71a012720e88b0c355190404ef7952c14f1ebd3eec4903dea40b7cc250e1000200e404420002001ec931001400bc8f9260a77ba3c80f113d8939604b37be98d2a2e00014003825c9d466173528dc98b21e6afd886b183404c0e0001400f9710b65550354ddae9240fd66c64f07715dc812e000140012b7ceb7672023935073fb79c5d8f900aa665171e00014001bb3cb52d5bfbb62168499b71b7074def292ad1fe000140097bc41e72f6c7c244d8c6fb5496034629c64402fe0001400bac49fcdc6fad85aca5401383baf07a0790b71b0e000140091257fc920b42cb667d81ec18635c1b7f1d8af3ce0001400fb1983eeaa9453908cb3aee1e9f3d25a06ce392be00014002b7801bc6bcd87bbe20c77fec03da4f45a74a99be0001400d1f69d3e2952e759a1648e40eb38260b7000adf5e000140023280922d600b48d7efbf989d83580e040a58ae0e0001400b543afc66674f3c3cc8bc87a374915bf185ae98ee0001400c054e3ef7e02b683167e4b418bfff4b72a2284d9e0001400ec2f2d6789e2bab89b94566bbbacac5ecba06ed3e0001400e967f3d4a0e1dfe321eab5cab455328169454ffbe0001400f68a469dfe2cd51ce2fd622a2bb40c28f15682eefc0017008a5b7f98b295595ef339f7bc06665feef5fc91a7e402e83c0013005ee54d071b5f8c1c9b8b8b517e5d9e9d78933585000c0038020000598473419ef471400a0000000908100000061000bb0dcc074100000006000000fd000a00950b4499540d7b1778070a000000"},
  {"mode":"multi-block-sst","input":"0908100000060500bb0dcc0741000000060000002f003600010001000100000102030405060708090a0b0c0d0e0f75893a71a012720e88b0c355190404ef7952c14f1ebd3eec4903dea40b7cc250e1000200e404420002001ec931001400bc8f9260a77ba3c80f113d8939604b37be98d2a2e00014003825c9d466173528dc98b21e6afd886b183404c0e0001400f9710b65550354ddae9240fd66c64f07715dc812e000140012b7ceb7672023935073fb79c5d8f900aa665171e00014001bb3cb52d5bfbb62168499b71b7074def292ad1fe000140097bc41e72f6c7c244d8c6fb5496034629c64402fe0001400bac49fcdc6fad85aca5401383baf07a0790b71b0e000140091257fc920b42cb667d81ec18635c1b7f1d8af3ce0001400fb1983eeaa9453908cb3aee1e9f3d25a06ce392be00014002b7801bc6bcd87bbe20c77fec03da4f45a74a99be0001400d1f69d3e2952e759a1648e40eb38260b7000adf5e000140023280922d600b48d7efbf989d83580e040a58ae0e0001400b543afc66674f3c3cc8bc87a374915bf185ae98ee0001400c054e3ef7e02b683167e4b418bfff4b72a2284d9e0001400ec2f2d6789e2bab89b94566bbbacac5ecba06ed3e0001400e967f3d4a0e1dfe321eab5cab455328169454ffbe0001400f68a469dfe2cd51ce2fd622a2bb40c28f15682eefc00a3088a5b7f98b295595e7531f7bc23463ecedad9f087852fc6fe59eab31fca6b66287bae32a8aeea725069b1b858a00d64faa66a3810c9c218c5360097d042640f96c57fb1d8aeec7c4696716541bda1ebfe5257672687e8a5df7ea6d44a05d81a4c3a5639464bd189ed3aacc37788bf28065e9a57e51c0f0d68a3d9454c9416f98833cde012f0124a2420cf3ac3142e833e93256dab7765e80b0c02c8da78b4055e8ebd9fc3d8b5526f60a7ac8d3348cc59f7874d87e7a14b833731820b8c95efb7d7a93acf7c86b68d34acfe3b7f61694158a419de34636999c661dfb8f58791223b306bd1d0254d6d3a97fe5bec60e69b03772fd9bd208ed53a27b83d750a3b07b23a56fe478b2d9d8094f5f1b402455d93ee30aa5eb9a6d6676fd02761aea7a5db786d15b6f6f3cdb403ae2d17cf234ffb1ab2ec65768060acb274c8a7975a584f2abc9bc172dd578d66adc1358b715f8f786d8cf29e1c6366492d67be353f7e39d8dc8043d0c8a2dddb2a64a07ae7fbb4c580ef02da5761d6ea3f67a2e6e7d234adf9e0d8e42fa2982232f563d5d7d2911eeb9014f5763cf813e8a0589d50727599de39826b6264de80de7525c0fbdffa3689d9c852226faee1816a9d5c5f75cc9ce64ff8f82bfd8a92ded7c03cc771945fbfe8dfd2f9c77537c4deeef0b962c3461ed903af8f2d64bb37cbdae7eca36fcc1b2535b3dcf53323a443195d5b9e2e2f65a77907033b3653453c032c99f41509fdd67d85de5541ff71d9bf8c8abef05957882407373cdcd6e709a9f576e6ef868535f827525a0061a11046c83172affeb04c7c9e19cc678a202e67bd4bd0009e4390ae9f35deabc349c1f09a4c65a28b5df6432ff67f66deb40a3a4970281c0c40f294b15e41dda5798d4468b60c2fe42ffcca0fb7cc767e8c2a857f826979bcf0285b433380793da9ace7c9e0f5f3c731f6a1be69dcb51438346619e531c6ecb5814653767b91bf8d5d87a2bffb87f306960e31ffb182e3778c9dfe93eb4589e90e70aa382138c0ebdf7e0aa5ec17e1654995436db39869964c49d8c4c85965e728126eed47529cb21373c504f61974f5318d11da79fc743cacd7f5e493ea1ada2e55f5d248b87be19193c63faf237dee644e87e8b56e6070e368536bb9b875731be1ea8dee207dd7538dc15bb878a032941a81f923b3b053c22717ddbcf4a894d155735305e316a5fa07b773b38174ad0d4d797257cefa0ff5b3fd2d5cb78ae646d980157a6ed9b459444ffec78d210dfec43de043379ecffee64b49df444a98d16aa37892264a03957dc8eb253d131a7e2e1810ba08852890f21e5780b67f0477f87cfc967a3570499e7232d16cbb68bcc09721b8e606d45832aba6febc3cb246d4e83d2a58b12019b75a0e3efa3cf2ef18e370a4ef1ec30694f15602a3142e387a175906b981a659b4d523e849d622512cbf329d59e5397173467f581f2f1505c6644cb5a1591b2dad5bcbe9acee2b6ea10704215c0959363b523fad2ff2fa9276c27f5ee107a4b6dd804c3271f2f93c9cd262ec720887b29f72176e08dc4dfb7e72c138d8e95cd22f8b0ca75ede9a1424291bcf5e15af6d581fe39b40992790e6bba05e27d37df49a5ea5212588b439b9bbd8bde4f6895213ec3d2b3ff8f6d69da1777291cb1ed5941feb2acf98d51765c1f2e22a0b1466f9523f22b0a9093b0f07916da151de6fa3c921161c7df5b195307def3f720556eda9b818210bce1de106eb21c82b50b5925b36bacd76e9187ec9c27be4daee5bc6fe5e8fcc8e4b261a5ef38ec35f6f6db6b9c5d5cfb179ca3b681f0d7e82b77cc46dbe676731259f8d40718843e576973c72806ff3676bec60300b1c5064bfa99b32986470192fbee63b4e72c9775f5cc3f7e645cd29e460fb375e4b8e4c31ef097974262296c7b9dac016be58417d470f8c53912ff4239930a158837cdc769237728a38ed0454eadfb0d3168e1eefd6f8f2a403c354a4fb93029506d68d7c97b05c5d7a0388cc4c35452449c440d8cf3a50937bfc4a177df8b6ef7dc9f1c218fb53623c3fd408e63feababbeb9a19b164bfde81ee47dae858f18b598609b11890236fca411aa5ee00d7608e4657a9eff04e91e3fb5f140038da8a047c5d59cb4184d914eafd160dd545fa9ff3e8ebc1e7485d91b2e9d58f1869e8374edaeb6885ea2e83e1b565de6a58effa1a2a2bde8ca26aa014c5c6e1cce48e5d64147972f5f980b426b631c9d19dee909b7116a203748a3c785e0fbc71e61b73d8656f3aae81abce0a4a9fad033112925111fcb4658bddb65973e6bc4748c3d9896c717074c3984a31f782ffb074729074c370d84643aca05811ca2b45e342a21375499f0e57ff02f7ab623a71205fd90f72047a211580523fda17fd2eb00c2413d705f586775d8431c9408f4ac0d988c9a87a88d9f1aca17a971ac672856251f1c8076d8d48e80b40803b2ebf8da165e8a97165ae7047ce4fc11fa69ff3bdf6b0c8e6c2fb110db138a337dac83b7641d2037d407410cf36f0372a74c2d61150589716dbf5169ff971de68358045ed64f7cb851652dbe9994cf73aceba5254e45f684018fe5de0a3b2ce862ac15ca26ed666a7853d44fff1b74e7d4cafcd2d38cd605d2ab6bf7216a043e2b36e21e4f5da38b5dcacc2c97017cd4fcb5532faeab3b9eeb9b0dc4e0691577aa3da1b5e0bfcffd6ad22ff8f28b242edf411a53d252eaa333a58aa003100eaebff877a860e804a16add913303feaeff18d444913a7db08945e3c6fa204d245d6eed918e0384fa8ba46878928cd681b20756083f541a494f318b3a7c85c3589ab78a2667f9dde7ae9e73c16b805184765601769d0a9e1ae1aebd0e52675ac39973d2bdc92d2a3ecfdf6519839589eb9e6f10b14361c07b2aa081ba86d1f67f7a033a8b1ef56125d5b5d5a66b6216eb9ca5441012358e893ebf4365c2fb23192d040969150db090a9addc6a9b33c5470a4bc85408d452fb1ffc31f17bf2944dc0693dda7623c8e62b03f0ae145cc5492395f0294f4798ad68ad03d568b50bd55cc3d23eec0a9ef1bb0a8f77b2960b7d6d42ede551ea7053fe3b150c3fb8015b115190ff549f9d38bc77198062649fd2f3585000c00ad0a0000fc3c9b74bb425dbe0a0000000908100000061000bb0dcc074100000006000000fd000a00dafe0463fd117ba70fc10a000000"},
 ];
function bytes(hex: string): Uint8Array { return Uint8Array.from(hex.match(/../g)!, part => parseInt(part, 16)); }
it.each(fixtures)("imports standard RC4 BIFF8 $mode without changing its source", async ({ mode, input }) => {
  const original = bytes(input), baseline = original.slice(), diagnostics: string[] = [];
  const book = await readBiff(original, { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(original).toEqual(baseline);
  expect(book.sheets[0]!.name).toBe("Here");
  const expected = mode === "multi-block-sst" ? { kind: "string", value: "A".repeat(2200) } :
    mode === "string" || mode === "sst" ? { kind: "string", value: "Ada and a long record boundary" } : { kind: "number", value: 42 };
  if (mode === "formula") expect(book.sheets[0]!.cells[0]!.formula).toBe("=41+1");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
  const output = await createBiffWriter(8)(book, [], context);
  expect(readBiffRecords(readCfb(output, context).get("Workbook")!, context).some(record => record.opcode === 0x2f)).toBe(false);
  expect(recalculateWorkbook(await readBiff(output, context), context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
  expect(diagnostics).toEqual([]);
});
it("opens RC4 in an original CFB Workbook container", async () => {
  const input = await writeCfb(new Map([["Workbook", bytes(fixtures[1]!.input)]]), context);
  const book = await readBiff(input, context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("rejects malformed RC4 headers, unknown versions and duplicate FILEPASS", async () => {
  const header = readBiffRecords(bytes(fixtures[0]!.input), context).find(record => record.opcode === 0x2f)!;
  for (const length of [5, 6, 22, 53, 55]) {
    const value = new Uint8Array(length); value.set(header.data.bytes.subarray(0, length));
    await expect(decryptBiffRecords([{ ...header, data: new Binary(value) }], 8, context)).rejects.toThrow("Invalid Excel BIFF");
  }
  for (const index of [2, 4]) {
    const value = header.data.bytes.slice(); value[index] = 2;
    await expect(decryptBiffRecords([{ ...header, data: new Binary(value) }], 8, context)).rejects.toThrow("encrypted Excel workbook");
  }
  await expect(decryptBiffRecords([header, header], 8, context)).rejects.toThrow("duplicate FILEPASS");
});
it("admits RC4 derivation and block work before payload copying", async () => {
  const records = readBiffRecords(bytes(fixtures[0]!.input), context);
  const payload = records.find(record => record.opcode === 0x42)!.data, copy = vi.spyOn(payload.bytes, "slice");
  await expect(decryptBiffRecords(records, 8, { ...context, limits: { ...context.limits, workbookWork: 1000 } })).rejects.toThrow("decryption work limit");
  expect(copy).not.toHaveBeenCalled();
  await expect(decryptBiffRecords(records, 8, { ...context, limits: { ...context.limits, workbookWork: 0 } })).rejects.toThrow("decryption work limit");
});
it("observes cancellation during multi-block RC4 without changing source bytes", async () => {
  const records = readBiffRecords(bytes(fixtures[4]!.input), context);
  const source = records.map(record => ({ data: record.data, original: record.data.bytes.slice() }));
  let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 40) throw new Error("cancel RC4 import"); } } as AbortSignal;
  await expect(decryptBiffRecords(records, 8, { ...context, signal })).rejects.toThrow("cancel RC4 import");
  // The public input stays immutable even if a previous internal record has completed decoding.
  source.forEach(({ data, original }) => expect(data.bytes).toEqual(original));
});
it("leaves specification-exempt records clear and charges only used blocks across large plaintext gaps", async () => {
  const header = readBiffRecords(bytes(fixtures[0]!.input), context).find(record => record.opcode === 0x2f)!;
  for (const opcode of [9, 0x209, 0x409, 0x809, 0x194, 0x195, 0xe1, 0x196, 0x138]) {
    const clear = { opcode, offset: 1000000, data: new Binary(bytes("1032547698badcfe")) }, records = [header, clear];
    await decryptBiffRecords(records, 8, context);
    expect(records[1]).toBe(clear);
  }
  const payload = { opcode: 0x85, offset: 1000000, data: new Binary(bytes("1032547698badcfe")) }, records = [header, payload];
  await decryptBiffRecords(records, 8, { ...context, limits: { ...context.limits, workbookWork: 2200 } });
  expect(records[1]!.data.bytes.subarray(0, 4)).toEqual(payload.data.bytes.subarray(0, 4));
  expect(records[1]!.data.bytes.subarray(4)).not.toEqual(payload.data.bytes.subarray(4));
  expect(payload.data.bytes).toEqual(bytes("1032547698badcfe"));
});
it("publishes exact RC4 conversion and preserves targets on verifier, version and work refusals", async () => {
  const original = bytes(fixtures[1]!.input), header = readBiffRecords(original, context).find(record => record.opcode === 0x2f)!;
  for (const mode of ["success", "verifier", "hash", "version", "work"]) {
    const input = original.slice();
    if (mode === "verifier") input[header.offset + 26]! ^= 1;
    if (mode === "hash") input[header.offset + 42]! ^= 1;
    if (mode === "version") input[header.offset + 6] = 2;
    const volume = Volume.fromJSON({ "/target.csv": "untouched\n" }); volume.writeFileSync("/input.xls", input);
    let writes = 0;
    const engine = createEngine({ codecs: [], environment: context.environment,
      limits: mode === "work" ? { ...context.limits, workbookWork: 0 } : context.limits,
      filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
        async write(uri, value) { writes++; volume.writeFileSync(uri, value); } } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    try {
      expect(await runCommand(["--recalc", "-T", "Gnumeric_stf:stf_csv", "/input.xls", "/target.csv"], engine,
        { signal: context.signal, stdout: { async write(value) { stdout.push(value); } }, stderr: { async write(value) { stderr.push(value); } } }))
        .toMatchObject({ exitCode: mode === "success" ? 0 : 1 });
      expect(volume.readFileSync("/target.csv", "utf8")).toBe(mode === "success" ? "42\n" : "untouched\n");
      expect(writes).toBe(mode === "success" ? 1 : 0);
      expect(new Uint8Array(volume.readFileSync("/input.xls") as Uint8Array)).toEqual(input);
      expect(stdout).toEqual([]);
      if (mode === "success") expect(stderr).toEqual([]);
      expect(Object.keys(volume.toJSON()).sort()).toEqual(["/input.xls", "/target.csv"]);
    } finally { await engine.dispose(); }
  }
});
