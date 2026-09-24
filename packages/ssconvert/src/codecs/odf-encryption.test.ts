import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { createZipCodec } from "@poe-code/office-package";
import { odfBlowfishVectors } from "./odf-blowfish-fixtures.js";
import { odfCipherVectors, expectedText } from "./odf-encryption-fixtures.js";
import { readOdf } from "./odf.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
// Independently OpenSSL-encoded ODF1.2 fixture; provenance in encrypted-odf-applicability.json.
const ciphertext = Uint8Array.from("0fe85a5cf383f6bcd629b681fe0ba655a2726b407e8a7c49fc231b20b9f4e2acbd76f739c85d7d097acca687437c28f75fe558fc6a7150b8888bd8f477d20ec8426c0375b8f03f7361ab7cfea42c3cb228dd839713c13ed247334d4b0935fc359e82cf6d6f55dcffe5fec62df1ff148d9cb1ad5b93ed8648012ebf30a268e93c112723fe0c25e72da1f3ea5bf7d9ed366e13bcd377bd76336d113a47b51fc60192e91bc25f54c6610c34236025ed32cc4e57a0d421c5df527e7e4a9b31c0c22145078470f1fbd9ddc601d70985fb4db4c1374ee96fd96620e885f92e22b1dab4".match(/../g)!, value => parseInt(value, 16));
const manifest = "<?xml version=\"1.0\"?><manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\"><manifest:file-entry manifest:full-path=\"/\" manifest:media-type=\"application/vnd.oasis.opendocument.spreadsheet\"/><manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\" manifest:size=\"546\"><manifest:encryption-data manifest:checksum-type=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k\" manifest:checksum=\"XCBwOZmT1KIE2A5YkE+KxX4ZL6DWHfdnIW7JMPk2MXQ=\"><manifest:algorithm manifest:algorithm-name=\"http://www.w3.org/2001/04/xmlenc#aes256-cbc\" manifest:initialisation-vector=\"EBESExQVFhcYGRobHB0eHw==\"/><manifest:key-derivation manifest:key-derivation-name=\"PBKDF2\" manifest:iteration-count=\"1024\" manifest:key-size=\"32\" manifest:salt=\"AAECAwQFBgcICQoLDA0ODw==\"/><manifest:start-key-generation manifest:start-key-generation-name=\"http://www.w3.org/2000/09/xmldsig#sha256\" manifest:key-size=\"32\"/></manifest:encryption-data></manifest:file-entry></manifest:manifest>";
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
async function fixture(declaration = manifest, payload = ciphertext, extra: readonly (readonly [string, Uint8Array])[] = [], compression: "store" | "deflate" = "store") {
  const zip = createZipCodec(), entries = [];
  for (const [name, data] of [["mimetype", new TextEncoder().encode("application/vnd.oasis.opendocument.spreadsheet")],
    ["content.xml", payload], ["META-INF/manifest.xml", new TextEncoder().encode(declaration)], ...extra] as const)
    entries.push(await zip.makeZipEntry(name, data, { modified: new Date("2000-01-01Z"), mode: 0o644,
      directory: false, symlink: false, compression: name === "content.xml" ? compression : "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
it("imports independently encrypted ODF through explicit host password authority", async () => {
  const input = await fixture(), before = new Uint8Array(input);
  const read = vi.fn(async () => "owned-odf-reference");
  const book = await readOdf(input, { ...context, password: { read }, inputFilename: "/encrypted.ods" });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(input).toEqual(before);
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(odfCipherVectors)("imports independent OpenSSL vector $name", async (vector) => {
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  const read = vi.fn(async () => vector.password);
  const book = await readOdf(await fixture(vector.manifest, payload), { ...context, password: { read } });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 42 }, { kind: "string", value: expectedText }
  ]);
  expect(read).toHaveBeenCalledTimes(1);
});
it.each([...odfCipherVectors, ...odfBlowfishVectors])("imports the standard PBKDF2 IRI with independent vector $name", async vector => {
  const declaration = vector.manifest.replace('manifest:key-derivation-name="PBKDF2"',
    'manifest:key-derivation-name="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#pbkdf2"');
  expect(declaration).not.toBe(vector.manifest);
  const payload = Uint8Array.from(Buffer.from(vector.ciphertextHex, "hex"));
  const input = await fixture(declaration, payload), before = new Uint8Array(input);
  const secret = new TextEncoder().encode(vector.password), originalSecret = new Uint8Array(secret);
  const read = vi.fn(async () => secret);
  const book = await readOdf(input, { ...context, password: { read } });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 42 }, { kind: "string", value: expectedText }
  ]);
  expect(read).toHaveBeenCalledTimes(1); expect(secret).toEqual(originalSecret); expect(input).toEqual(before);
});
it.each(["work", "corrupt"])("preserves publication and password admission with the PBKDF2 IRI on %s failure", async mode => {
  const declaration = manifest.replace('manifest:key-derivation-name="PBKDF2"',
    'manifest:key-derivation-name="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#pbkdf2"');
  const payload = new Uint8Array(ciphertext); if (mode === "corrupt") payload[0] = payload[0]! ^ 1;
  const input = await fixture(declaration, payload), before = new Uint8Array(input);
  const volume = Volume.fromJSON({ "/target.csv": "untouched\n" });
  const read = vi.fn(async () => "owned-odf-reference"), write = vi.fn(async (uri: string, bytes: Uint8Array) => { volume.writeFileSync(uri, bytes); });
  const engine = createEngine({ codecs: [], environment: context.environment,
    limits: mode === "work" ? { ...context.limits, workbookWork: 1 } : context.limits,
    password: { read }, filesystem: { async read() { return [input]; }, write } });
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "encrypted.ods", source: [input] },
      destination: { kind: "resource", uri: "/target.csv" }, exportType: "Gnumeric_stf:stf_csv" }, context))
      .rejects.toMatchObject({ code: mode === "work" ? "resource-limit" : "io" });
    expect(read).toHaveBeenCalledTimes(mode === "work" ? 0 : 1); expect(write).not.toHaveBeenCalled();
    expect(volume.readFileSync("/target.csv", "utf8")).toBe("untouched\n"); expect(input).toEqual(before);
  } finally { await engine.dispose(); }
});
it("passes a frozen explicit ODF request and accepts raw UTF8 without changing host bytes", async () => {
  const secret = new TextEncoder().encode("owned-odf-reference"), before = new Uint8Array(secret);
  const read = vi.fn(async (request: Parameters<NonNullable<CapabilityContext["password"]>["read"]>[0]) => {
    expect(Object.isFrozen(request)).toBe(true);
    expect(request).toMatchObject({ format: "odf", algorithm: "aes-cbc", revision: "1.2", encoding: "utf8",
      maxBytes: 4096, inputFilename: "/encrypted.ods", signal: context.signal });
    return secret;
  });
  expect((await readOdf(await fixture(), { ...context, password: { read }, inputFilename: "/encrypted.ods" })).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(secret).toEqual(before);
});
it.each(["wrong password", undefined])( "rejects a wrong or declined password %s", async (secret) => {
  await expect(readOdf(await fixture(), { ...context, password: { read: async () => secret } })).rejects.toMatchObject({ exitCode: 1 });
});
it("sanitizes password callback failure", async () => {
  await expect(readOdf(await fixture(), { ...context, password: { read: async () => { throw new Error("owned secret must not leak"); } } })).rejects.toMatchObject({
    code: "unsupported-feature", message: "Unsupported ssconvert feature: encrypted OpenDocument password acquisition failed" });
});
it.each([
  ["unsupported cipher", manifest.replace("aes256-cbc", "unknown-cipher"), "unsupported-feature"],
  ["unsupported derivation", manifest.replace('name="PBKDF2"', 'name="unknown-kdf"'), "unsupported-feature"],
  ["foreign derivation IRI", manifest.replace('name="PBKDF2"', 'name="urn:foreign#pbkdf2"'), "unsupported-feature"],
  ["case-mismatched derivation IRI", manifest.replace('name="PBKDF2"', 'name="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#PBKDF2"'), "unsupported-feature"],
  ["excessive KDF", manifest.replace('count="1024"', 'count="1000000000"'), "resource-limit"],
  ["missing KDF count", manifest.replace(' manifest:iteration-count="1024"', ''), "io"],
  ["zero KDF count", manifest.replace('count="1024"', 'count="0"'), "io"],
  ["wrong AES key size", manifest.replace('key-size="32"', 'key-size="16"'), "io"],
  ["excessive plaintext size", manifest.replace('size="546"', 'size="1000000"'), "resource-limit"],
  ["bad IV", manifest.replace('EBESExQVFhcYGRobHB0eHw==', 'AAAA'), "io"],
  ["invalid base64", manifest.replace('EBESExQVFhcYGRobHB0eHw==', '*invalid*'), "io"],
  ["wrong part", manifest.replace('full-path="content.xml"', 'full-path="missing.xml"'), "io"]
] as const)("admits %s before accessing host secrets", async (_, declaration, code) => {
  const read = vi.fn(async () => "owned-odf-reference");
  await expect(readOdf(await fixture(declaration), { ...context, password: { read } })).rejects.toMatchObject({ code });
  expect(read).not.toHaveBeenCalled();
});
it("rejects truncated ciphertext before accessing host secrets", async () => {
  const read = vi.fn(async () => "owned-odf-reference");
  await expect(readOdf(await fixture(manifest, ciphertext.subarray(0, -1)), { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  expect(read).not.toHaveBeenCalled();
});
it("checks ciphertext corruption before exposing plaintext", async () => {
  const corrupt = new Uint8Array(ciphertext); corrupt[0] = corrupt[0]! ^ 1;
  await expect(readOdf(await fixture(manifest, corrupt), { ...context, password: { read: async () => "owned-odf-reference" } })).rejects.toMatchObject({
    code: "io", message: "E Invalid OpenDocument: encrypted content could not be verified" });
});
it.each([new Uint8Array([255]), "x".repeat(4097), new Uint8Array(4097)])("rejects invalid or excessive UTF8 secret", async (secret) => {
  await expect(readOdf(await fixture(), { ...context, password: { read: async () => secret } })).rejects.toMatchObject({ code: "unsupported-feature" });
});
it("observes cancellation immediately after secret acquisition", async () => {
  const controller = new AbortController(), read = vi.fn(async () => { controller.abort(); return "owned-odf-reference"; });
  await expect(readOdf(await fixture(), { ...context, signal: controller.signal, password: { read } })).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toHaveBeenCalledTimes(1);
});
it("observes cancellation during PBKDF2 work", async () => {
  const controller = new AbortController();
  await expect(readOdf(await fixture(), { ...context, signal: controller.signal, password: { read: async () => {
    setTimeout(() => controller.abort(), 0); return "owned-odf-reference";
  } } })).rejects.toMatchObject({ name: "AbortError" });
});

it.each([
  ["plaintext then encrypted", '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' + manifest.slice(manifest.indexOf('<manifest:file-entry manifest:full-path="content.xml"'), manifest.indexOf('</manifest:manifest>'))],
  ["encrypted then plaintext", manifest.slice(manifest.indexOf('<manifest:file-entry manifest:full-path="content.xml"'), manifest.indexOf('</manifest:manifest>')) + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>']
])("rejects ambiguous %s declarations before secret access", async (_, declarations) => {
  const declaration = manifest.slice(0, manifest.indexOf('<manifest:file-entry manifest:full-path="content.xml"')) + declarations + '</manifest:manifest>';
  const read = vi.fn(async () => "owned-odf-reference");
  await expect(readOdf(await fixture(declaration), { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  expect(read).not.toHaveBeenCalled();
});
it.each(["\ud800", "\udfff", "valid\ud800text"])("rejects malformed UTF16 host password before deriving a key", async (secret) => {
  await expect(readOdf(await fixture(), { ...context, password: { read: async () => secret } })).rejects.toMatchObject({
    code: "unsupported-feature", message: "Unsupported ssconvert feature: encrypted OpenDocument password encoding or length" });
});

it.each([false, true])("verifies ancillary encrypted members before returning a workbook (corrupt=%s)", async (corrupt) => {
  const vector = odfCipherVectors[0]!, ancillary = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  if (corrupt) ancillary[0] = ancillary[0]! ^ 1;
  const declaration = vector.manifest.slice(vector.manifest.indexOf('<manifest:file-entry manifest:full-path="content.xml"'), vector.manifest.indexOf('</manifest:manifest>')).replace('full-path="content.xml"', 'full-path="Objects/data.bin"');
  const input = await fixture(manifest.replace('</manifest:manifest>', declaration + '</manifest:manifest>'), ciphertext, [["Objects/data.bin", ancillary]]);
  const read = vi.fn(async () => "owned-odf-reference");
  if (corrupt) await expect(readOdf(input, { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  else expect((await readOdf(input, { ...context, password: { read } })).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(read).toHaveBeenCalledTimes(1);
});
it("refuses compressed encrypted ZIP framing before secret acquisition", async () => {
  const read = vi.fn(async () => "owned-odf-reference");
  await expect(readOdf(await fixture(manifest, ciphertext, [], "deflate"), { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  expect(read).not.toHaveBeenCalled();
});
it.each(["absent", "wrong", "declined", "callback", "work", "corrupt"])("preserves public-command targets on %s refusal", async (mode) => {
  const payload = new Uint8Array(ciphertext); if (mode === "corrupt") payload[0] = payload[0]! ^ 1;
  const volume = Volume.fromJSON({ "/target.csv": "untouched\n" });
  const input = await fixture(manifest, payload); volume.writeFileSync("/input.ods", input);
  let writes = 0;
  const engine = createEngine({ codecs: [], environment: context.environment,
    limits: mode === "work" ? { ...context.limits, workbookWork: 0 } : context.limits,
    ...(mode === "absent" ? {} : { password: { async read() {
      if (mode === "callback") throw new Error("secret private failure");
      return mode === "wrong" ? "wrong" : mode === "declined" ? undefined : "owned-odf-reference";
    } } }),
    filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, value) { writes++; volume.writeFileSync(uri, value); } } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  try {
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "/input.ods", "/target.csv"], engine,
      { signal: context.signal, stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write(bytes) { stderr.push(bytes); } } })).toEqual({ exitCode: 1 });
    expect(writes).toBe(0); expect(stdout).toEqual([]);
    expect(volume.readFileSync("/target.csv", "utf8")).toBe("untouched\n");
    expect(volume.readFileSync("/input.ods")).toEqual(Buffer.from(input));
    expect(new TextDecoder().decode(Uint8Array.from(stderr.flatMap(bytes => [...bytes])))).not.toContain("secret private failure");
  } finally { await engine.dispose(); }
});

it("rejects authenticated-prefix payload with trailing raw-deflate bytes", async () => {
  const payload = Uint8Array.from("8829aad2e4715c9b65c475f5598727989e6764e9206d8189203722d73f85d19b5139e9c8e2e192fbb6a36ae114d0a6f4a101f0d82d6e7260c97fada6b791809e3323d18cb59d98e7fcd9b4d49ef222e2b228ce0414cbc1cc424e9fc2d9d5fb37b22baefa70b4c868e79cd694bf9bac0f4a3f29eec13a25c9b3884418a4f0a5e2911cf320cbb34b9dba4aa3a9eef0029aea62de3d4be2afe58e35f87dc977fd6445ccd481394926e15ff25b1a83bcbf4f93d4e1fdb80077649428c38b8969578aab90a62ee0bab361bde9f22395163a9c8537f64998b2b8c29d3db2b5385d3f6de22d8aefa05c7ddb6dfe0bf568c68e7bd551e71a7d680cf3423134b977e699964eefbafcdd933a0ee15489d28f7d47ba839dac76b4684ad33d59089ecbc87e9417306270e0752c69ab9751f74e37869afd3c953c9e9b2f439acadcc11fa34faae61748593cb70ae761bb5a4502e6cdba6f8bbdea25d2f2dc7e102010240b34496f6324adb1f8eaf41ea4bf714b8f9076f8cb4e5a271ae555426f14c172891117fc75a3723f935f8863018288700621c5a4985d1e9625e508fdca6904ef1b9b1b1e340443b4df772c19bf1472fe970ac8634c0cb06c56d572e28a2474ae1f3fbf93994f11a3f14bcce90c0e203ee5e12cedad2ab462452d2c84901fef751184b4292437d0e0907ba6a13d7e8653ed017193e8b4b7472bc34265b244b106dcb84a6a6e0a48ce152d557d2155b604419a18dbafd63227bfc30cee60666ef5a35ee688b92c4dab05ce3c67beb124c607ecfc9fc04ec482100ce3e24165112d27248bf326d3f01c9149bb02967a0fd270b426a9b67bd828f1ebee8da3e9cdd481ef23a482a9aa59819bac00df86624ab96f2f7bb8fcb68bd19ac942c9fef41ff62f73c475c453ba30bf7a98397eaab593d8dcd76e0f9563e9c8c50e4d841e18f4648560d7218641368eb106ae99118c2fa5747ed72b691f0d397b629cee5c71ede303343fc577f95c39718df941838cda28386f306361fc34d2cb49aeddcf5227d57967703edd53adab35e61e9351f0c42097d752e094fcf42c678d42698bcd71d2b85708e78b401bc6f1be307366f2d7246d7034c99234afd53300b27b39400e9ae167c496ffc9c2631ea3e1642f82addc0a5a5b020881e49c241921bdcbb13cd76c56cae9787eec02efbbdc1a594bd972e828a53605137c704f4831ef26d592322e134b305fab17ac1b5a278c5c7213e34c535c3b7a48cac6a992101a213fa53d00b95270204828a24dacde85112cf0089b02951965ac344208b3b57d190842a8cb44f7ff8d0419814892a550e11a961158f5e10ef15dd93c7207357bfe5d501d9c40c292f657ca5ca53e2c2bcb1ffe1e114f4cfeea85c0293e9897ebbc1ea094bc25483440bd2388bfb832f004955ada607593d216ca71fdc8c48aa0c56340fcf0cea2da78a2683865d954f910fdf6b6e5eb53a7ce48a6dba85d3d230c4c80ce475255a618110f6f3fe54848295364c814cb7b2cb0c7919eddee00cdf4c8beffe2784d1746520c0c105ee2efa5ed26a7e07f9ebcd541c71138f969e710d527fd44745bfb1f49c5a33312bc3489327dcffbbee7dc7ae6de8a671f54529366f833ccaabef60b4a53e4d8613e13441e3cec2378022556560c44fdb6372f68d55826abef107884ffb4fc73eb31f7a52610f663151292a90b3307c1f5f218735b01c18504e8254a76b45012bd843c4ba0fdc9f7e056a2a62f42b8d2baba8af9058b36c5e4817db0b882cf99706110f8701cb6701372eb0432ea2be660f01e669ee7ae022ed24bc6a51a4ff3f6f62dcfe7d6598cbe174e260ccb529fabe9a88460ba6ec214071b4f39a0548001c0db7434bb0073d6c1b8bacaed5a618e82c8c9411a29b8d171733aa6c229db11976d01e766a968aefa029e55c385af078c981488df0650d057e94625fa10c4e82d5d0fbc2ee96f97c3257e836a91c5294dbc102146748fd69cf83be6ed7cdb3581a7c531ffba6f87c48a494e9966f1ade7954d3e88790b0319c63dfd5cf40feda952a1a242033e7a525c2bfe70208f8095756d8f2928cbfacb0d19f80d1d29e2c01ad9f2c77055ccc8eef31902302c2eb792efc45534131a4900f77806b18b2e66272b4531a9fa073cff7a5e259fea4a7b21c5c42fb75ed851d836281a6ea8c83e0c57b041db01f17b05b00c52cc76cd5976666dc2ab4a5d42a97eac14d972a3500af1f898805403aca0e234c02e5b970c0e1d81db0b0c40604aa33fb3fb19efa14bcb64084a609feb78d8bd27107347a896db0b334c8c90459dc534c6023022ac2e6596ba94ea929746a377eb7280fe304e3991a0c5f3b03ccb9873bad18cf7afb62a67b117a43cba113399b34a6a8371f5943dd31cb4fee57ae17ef4bf9ab624edc2fb847aaedaf8e172063c56ebad902f94b9d61e4569443547b23844b4cd29a826b574622c466b3e32bdd294b9355ac66b0d06a40107595f2869a692af00d71ded5751d945d89a6ab26ea1ed86f974730203783421ba6c85cdc9195ae42f2dbec197afb044a8565e98e4ee5872e96e40936b6231550b2f8aee1cc23530f3f51ab74531a8900628bb138352cdf27336f67a62ceab6fe3053f52ed5725b4b412572be09416bae09d91683934419c66c022bec4d0a70369d8e438113cb964e4c250e8605cbbeda94520d53418480035b9614e6329d99322dd59da692bdd5e3dd2ff9f4cf15e66a9203bd8fd576cc260af50ec1fa13eb1d55d6543e80f00f52a4ebe1989592f2d0db8070660d235f3ae4db5093e7c57e8000820b8a6d2f85a1193524cffeba4c717a8729c2c45762c6bf6a0fc7906bae3f5ec2164d2b2db9f4a3689df56e5c43b0c58b1c969e0198d84341f92ab19545c958f7b00baec9f67915f9bbafc72d9eb6321d6c274d7a96839b33cb5b8338a4ae9d38956c22624c8b91f4c8ae3918cfb8a2f507f0f4756239c372da5fd05f3886c76118eba1fc0ae0428fac51da188602ed6c76ce7235e00ae5671c91d192d4531956f110ddc310e309ad36b4fbbdeb7761735d48510ca55a41534cd57cd90986e6a291163d2e30210b4a5007e033a4cdb1d4148fbc44d01859d6d636147f383f1c5b885767c4233655f2e90f8cd3251c340dc6faf4245e342988b878cfc263df4f61a76e7bd8558d1950e82cf7fb0222fe75792d281759c419413cc5fc92a3f4af877fb93561bfd50f77141253c23fcf745ce71cfa5b414f7c758d02f634a9b7357c0a9eff883fd89f2019f69d8d5991f3f32055f1a2f65ca80723c69270e1cc8012eb7ba17421b02076de291c68ca98c95a558e8ccb0caf47b1c639a91d75d9f5b35b4728f0098debae94cbe00e0bbe0ca4171d30add51c5447f5aa4e4ac670a5cd0a34ca8351752ab3392cac372e7213096f0e5f424e9dead51dec208bae667f3f4cbcda2e376e781f1c97cd10c6df08b381da9fd41aae70977a001eb41579d9b9dfab143bc25187d2e390f7fae1fa9da49bd7fa129cd566f21c810953d3e958a7fb37f6569430031c50f33e1cceaecd539a78e632e86e9d162b875e48bc26988719e24f82d9629e2d0804bf18e2e138b59d75a8c42315c8394ee5d98acb93d249b94a051c69d84a8126906b80b3181567ebc0daa2db1c58257b2417c91a11b5c94afbb486c6aed621a94a3c5371beb092e9f9f076597dc9d57a92ae8291645c7a97726aaf7c822af7eefb105d3edcba14c56b423033a8345cbf63a1414246dba6f77598cbc8454302174e72ddfd7b8e419f74e48f60477191af882b95f0b5f23c5be63fac59ac0d868b5c2671e9ad481d11ba20063484fa60bc9fe134c00812a7f27e058cebd55edc52460cc6cf5e2e225cc3941d5fdffd1e4304f179c387aecee9b1c621f35f96d38011e13e765427533b4b1c6190c148953e6cea412eba6b103abe61c35c62f2342c71d9900708c51643911ca865081f0547cb37d3ba10ca1669b524cf629180e0570c1fe78c0e4a099498a412351c2c2f205895cff5b5e3568ddd9dd3f14f35e83ebb23be6562270074d3badc58a88a099f563bebec04d880df72e86564fb0a321d928a2afccb59c12a2ffb98bd4715ce2a63f3912d15b159feea6f74dfdaec1c82f3b9aece26171a022074a85f020ac8e0cde37e065ec124d94daa5bb227071038c4483bffda40781af14c9cbf217eac3b9da2b1153d5b478bbdf0a3040b6bce94ef7dc21341ae3fef0de0aeb1a47db08aa8dc931f82cb37eb8beb37c1bcd7e3a16736d7043c2e1ae884c650e8b3ba8a9763dc6d6ff033eedefd6732f0f9c16419536f680b13425d03556eaa9625f5bd763036788eec203f15dd202732a335256c605f844ad14087c7e15eb064921604132a19150d9e4ecf4c482724eb14147b98993a7f1c5099d5f185c880ce796b9198a98624b4535e45d46d446d906437582236d05e06aa2af5195cb2c823088058913b29a47e343f5025fc68009fff0f2eeab660d2f2f9c0d597fb5adb136924ac9e611aa5f2d7dd460cb308a43450315d1714a14d41ae2f549658fe591b2b375ac65ebe412ebffad8e49954c686a9c8ba0d3c670ccfd55aaa19e4083186f358b6964c344ae21b831fb8e6e7af0a05f15b63c13c42d222c2f012916ad47f997ad1defe559026f5a760549fa7ff1abf98ef2404674efe6bfdbb027d5f6ee7072170aab2c738a8caea78f14b35fa073d2d983c4694bc5890bd1269a2d422b521214a824ce8d75844d3274964730fcde66998e9a099ffd39d466150ac869579bd7b74e6a18607dc95174041ee36e987b5d80566ab5915f02".match(/../g)!, value => parseInt(value, 16));
  await expect(readOdf(await fixture(odfCipherVectors[0]!.manifest, payload), { ...context, password: { read: async () => "owned-odf-reference" } })).rejects.toMatchObject({ code: "io", message: "E Invalid OpenDocument: encrypted content could not be verified" });
});

it.each([545, 547])("rejects exact declared plaintext-size mismatch %s", async (size) => {
  await expect(readOdf(await fixture(manifest.replace('size="546"', 'size="'+size+'"')), { ...context, password: { read: async () => "owned-odf-reference" } })).rejects.toMatchObject({ code: "io" });
});

it.each(odfBlowfishVectors)("imports independent PyCryptodome CFB8 vector $name", async (vector) => {
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  const read = vi.fn(async () => vector.password);
  const book = await readOdf(await fixture(vector.manifest, payload), { ...context, password: { read } });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 42 }, { kind: "string", value: expectedText }]);
  expect(read).toHaveBeenCalledTimes(1);
});
it("acquires one mixed-profile password after admitting every encrypted member", async () => {
  const vector = odfBlowfishVectors[0]!;
  const declaration = vector.manifest.slice(vector.manifest.indexOf('<manifest:file-entry manifest:full-path="content.xml"'), vector.manifest.indexOf('</manifest:manifest>')).replace('full-path="content.xml"', 'full-path="Objects/data.bin"');
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  const read = vi.fn(async (request: Parameters<NonNullable<CapabilityContext["password"]>["read"]>[0]) => {
    expect(request).toMatchObject({ format: "odf", algorithm: "mixed", revision: "1.2", encoding: "utf8" });
    return "owned-odf-reference";
  });
  expect((await readOdf(await fixture(manifest.replace('</manifest:manifest>', declaration + '</manifest:manifest>'), ciphertext, [["Objects/data.bin", payload]]), { ...context, password: { read } })).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(read).toHaveBeenCalledTimes(1);
});
it("admits aggregate feedback work before acquiring a password", async () => {
  const vector = odfBlowfishVectors[0]!, read = vi.fn(async () => vector.password);
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  await expect(readOdf(await fixture(vector.manifest, payload), { ...context, limits: { ...context.limits, workbookWork: 400000 }, password: { read } })).rejects.toMatchObject({ code: "resource-limit" });
  expect(read).not.toHaveBeenCalled();
});
it("accepts legacy default start generation and derived key size", async () => {
  const vector = odfBlowfishVectors[0]!, at = vector.manifest.indexOf('<manifest:start-key-generation');
  const declaration = (vector.manifest.slice(0, at) + vector.manifest.slice(vector.manifest.indexOf('/>', at) + 2)).replace(' manifest:key-size="16"', '').replace(' manifest:checksum-type="SHA1/1K"', '');
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  expect((await readOdf(await fixture(declaration, payload), { ...context, password: { read: async () => vector.password } })).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it.each([3, 57])("rejects unsupported Blowfish key size %s before secret acquisition", async (size) => {
  const vector = odfBlowfishVectors[0]!, read = vi.fn(async () => vector.password);
  const payload = Uint8Array.from(vector.ciphertextHex.match(/../g)!, value => parseInt(value, 16));
  await expect(readOdf(await fixture(vector.manifest.replace('key-size="16"', 'key-size="'+size+'"'), payload), { ...context, password: { read } })).rejects.toMatchObject({ code: "unsupported-feature" });
  expect(read).not.toHaveBeenCalled();
});
