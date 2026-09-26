import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { readParadox, writeParadox } from "./paradox.js";
import { encryptParadoxTable } from "./paradox-encryption.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 4, operations: 1000 } };
const options = ["encryption=paradox"];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function workbook(rows = 145, width = 20): Workbook {
  const cells: Cell[] = [
    { row: 0, column: 0, value: { kind: "string", value: "Value,S,2" } },
    { row: 0, column: 1, value: { kind: "string", value: `Message,A,${width}` } }
  ];
  for (let i = 0; i < rows; i++) cells.push(
    { row: i + 1, column: 0, value: { kind: "number", value: i - 7 } },
    { row: i + 1, column: 1, value: { kind: "string", value: i % 5 === 0 ? `café${i}` : `row${i}` } }
  );
  return { sheets: [{ id: "s", name: "Private", cells }] };
}
function bindings(secret: string | Uint8Array | undefined = new TextEncoder().encode("test")) {
  const read = vi.fn<NonNullable<CapabilityContext["password"]>["read"]>(async () => secret);
  const entropy = vi.fn(async () => new Uint8Array(32));
  return { read, entropy, context: { ...context, password: { read }, entropy: { read: entropy } } };
}

// Complete-file ciphertext from authenticated full pxlib 0.6.8. Each native
// Gnumeric read preserved all 145 records across two physical blocks.
it.each([
  [new Uint8Array([0x61]), 0x35ffeeab, "36a801da4c7f1f678f5f6226f810ce2a5ade0891e28431797f4ff322caf59181"],
  [new TextEncoder().encode("test"), 0x20e26198, "c02dc0bdd742f8fb30be916a4239f5831088add295fc69e3b6c976e97ac21d10"],
  [new TextEncoder().encode("0123456789abcde"), 0xe10eee8e, "1aa6a479610adbca99e30154281d9fd7062a24b6a22b1cb2c7fb8f54419d52f4"],
  [new Uint8Array(256).fill(0x61), 0x7b16eeab, "71c6ba65c3aa9e931f92e60b6de2dda1f4cad2d73bd5775d2e5d5d56461c0b4b"],
  [new Uint8Array([0x80, 0xe9, 0xff]), 0xdc704de4, "c69225142ec3a37ff514681b878aea44303d6ffa4bd201676aa10ecff4ed6ae8"],
  [new Uint8Array([0x61, 0, 0x7a]), 0x35ffeeab, "36a801da4c7f1f678f5f6226f810ce2a5ade0891e28431797f4ff322caf59181"]
] as const)("matches native encrypted table vector %#", async (secret, key, sha256) => {
  const host = bindings(secret), original = secret.slice(), book = workbook();
  const output = await writeParadox(book, options, { ...host.context, outputFilename: "/private.db" });
  expect(digest(output)).toBe(sha256);
  expect(new DataView(output.buffer, output.byteOffset).getUint32(92, true)).toBe(key);
  expect(host.read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: "encrypt", format: "paradox",
    algorithm: "paradox", revision: 12, encoding: "bytes", maxBytes: 256, outputFilename: "/private.db", signal: context.signal }));
  expect(Object.isFrozen(host.read.mock.calls[0]![0])).toBe(true);
  expect(host.entropy).not.toHaveBeenCalled();
  expect(secret).toEqual(original);
  const imported = await readParadox(output, { ...context, password: { async read() { throw new Error("No import password"); } } });
  expect(imported.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value]))
    .toEqual(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value]));
});

it("matches independent pxlib keys across every admitted nonempty password length", async () => {
  const keys = new Uint8Array(256 * 4), view = new DataView(keys.buffer);
  for (let length = 1; length <= 256; length++) {
    const secret = Uint8Array.from({ length }, (_, i) => (length * 17 + i * 37) % 255 + 1);
    const output = await writeParadox(workbook(0), options, bindings(secret).context);
    view.setUint32((length - 1) * 4, new DataView(output.buffer, output.byteOffset).getUint32(92, true), true);
  }
  expect(digest(keys)).toBe("3e012a7c2bdd30f7bd8340337bed64fec8be0a63639f6eca6b5d46191cb73ebe");
});

it("preserves native physical block-number wrapping", async () => {
  const bytes = new Uint8Array(512 + 257 * 1024), view = new DataView(bytes.buffer);
  view.setUint16(2, 512, true); bytes[5] = 1;
  const pattern = Uint8Array.from({ length: 1024 }, (_, i) => (i * 37 + 13) & 255);
  for (let block = 0; block < 257; block++) bytes.set(pattern, 512 + block * 1024);
  await encryptParadoxTable(bytes, { ...bindings().context,
    limits: { ...context.limits, inputBytes: 1000000, outputBytes: 1000000 } });
  expect(view.getUint32(92, true)).toBe(0x20e26198);
  for (const [block, sha256] of [
    [1, "d9e89e7a108402da64058e9adc293efa953d615abf9b3d6e3f2537a1ed27c647"],
    [2, "6ae5bb9d47fd76b7cce6bd9fe1ad4af6810cce35ed0ab905de288be90cc71f5a"],
    [255, "210431cc2974f6c6967cd6050e176c09685c6e7aa2288e8dab786cbcdea8f31b"],
    [256, "b7638946cdba01ebb64338ba1545c441635bd2d238582fce16ca46f0ff8051a7"],
    [257, "d9e89e7a108402da64058e9adc293efa953d615abf9b3d6e3f2537a1ed27c647"]
  ] as const) expect(digest(bytes.subarray(512 + (block - 1) * 1024, 512 + block * 1024))).toBe(sha256);
});

it.each([
  [0, 20, "ba112f1b5b2015ef91172d2e3bca6178c40f24d77bea3565a2f7d900dadcb447"],
  [1, 20, "4b82f10200c49fba62eecd93eece8172b14bb23e7879277f7f3ede20903c5dc8"],
  [31, 100, "3b5ba3d66fe003418613b3166b94cb592ebd31ba2ebc27c0f0f02084111064fe"],
  [82, 200, "81db7dc2f7da6dff4a88fe7d1c7cf061f780f056775d0e3a4354dfe0c59360f6"]
] as const)("matches native ciphertext for %i records and field width %i", async (rows, width, sha256) => {
  expect(digest(await writeParadox(workbook(rows, width), options, bindings().context))).toBe(sha256);
});

it("keeps plaintext the default without invoking host secrets or entropy", async () => {
  const host = bindings();
  expect(digest(await writeParadox(workbook(), [], host.context)))
    .toBe("e70050a7afc333909b625644956fda66288b9ce92bcf8ad328986c101b0319aa");
  expect(host.read).not.toHaveBeenCalled(); expect(host.entropy).not.toHaveBeenCalled();
});

it.each([undefined, "test", "", new Uint8Array(), new Uint8Array([0]), new Uint8Array([0, 0x61]),
  new Uint8Array(257).fill(0x61), new Uint8Array([0x61, 0, ...new Uint8Array(255)])])(
  "refuses absent, implicit, empty-effective or oversized password %#", async secret => {
    const host = bindings(); host.read.mockResolvedValue(secret);
    const original = secret instanceof Uint8Array ? secret.slice() : secret;
    await expect(writeParadox(workbook(0), options, host.context)).rejects.toThrow("password");
    expect(secret).toEqual(original); expect(host.entropy).not.toHaveBeenCalled();
  });

it("requires a password capability and validates profiles before invoking it", async () => {
  await expect(writeParadox(workbook(0), options, context)).rejects.toThrow("password capability");
  const host = bindings();
  await expect(writeParadox(workbook(0), ["encryption=unknown"], host.context)).rejects.toThrow("encryption profile");
  expect(host.read).not.toHaveBeenCalled();
});

it("sanitizes password callback failures", async () => {
  const host = bindings(); host.read.mockRejectedValue(new Error("private-secret"));
  await expect(writeParadox(workbook(0), options, host.context)).rejects.toThrow("password acquisition failed");
});

it.each(["work", "output"])("admits %s before password access", async boundary => {
  const host = bindings();
  const limits = { ...context.limits, ...(boundary === "work" ? { workbookWork: 0 } : { outputBytes: 2047 }) };
  await expect(writeParadox(workbook(0), options, { ...host.context, limits })).rejects.toMatchObject({ code: "resource-limit" });
  expect(host.read).not.toHaveBeenCalled();
});

it("stops after cancellation in the password callback", async () => {
  const controller = new AbortController(), host = bindings();
  host.read.mockImplementation(async () => { controller.abort(new Error("cancel password")); return new Uint8Array([0x61]); });
  await expect(writeParadox(workbook(0), options, { ...host.context, signal: controller.signal })).rejects.toThrow("cancel password");
});

it("yields during physical block encryption for host cancellation", async () => {
  const controller = new AbortController(), secret = new Uint8Array([0x61]), host = bindings(secret);
  let timer: ReturnType<typeof setTimeout> | undefined;
  host.read.mockImplementation(async () => {
    timer = setTimeout(() => controller.abort(new Error("cancel cipher")), 0); return secret;
  });
  try {
    await expect(writeParadox(workbook(400, 200), options, { ...host.context, signal: controller.signal })).rejects.toThrow("cancel cipher");
    expect(secret).toEqual(new Uint8Array([0x61]));
  } finally { clearTimeout(timer); }
});

it("exports an engine-owned workbook through the direct SDK with the same explicit profile", async () => {
  const host = bindings(), fs = Volume.fromJSON({ "/in.csv": '"Value,S,2","Message,A,20"\n42,record\n' });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    password: host.context.password, entropy: host.context.entropy,
    filesystem: { cwd: "/", async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { fs.writeFileSync(path, bytes); } } });
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/in.csv" }, {}, { signal: context.signal });
    const result = await engine.writeWorkbook(book, { kind: "resource", uri: "/sdk.db" },
      { exportType: "Gnumeric_paradox:paradox", exportOptions: options }, { signal: context.signal });
    expect(result.exitCode).toBe(0); expect(result.diagnostics).toEqual([]);
    const output = new Uint8Array(fs.readFileSync("/sdk.db") as Uint8Array);
    expect(new DataView(output.buffer).getUint32(92, true)).toBe(0x20e26198);
    expect((await readParadox(output, context)).sheets[0]!.cells.map(cell => cell.value)).toEqual(book.sheets[0]!.cells.map(cell => cell.value));
    expect(host.read.mock.calls[0]).toEqual([expect.objectContaining({ purpose: "encrypt", outputFilename: "/sdk.db" })]);
    expect(host.entropy).not.toHaveBeenCalled();
  } finally { await engine.dispose(); }
});

it.each(["success", "missing", "callback", "work", "output", "invalid-schema"])(
  "preserves public command publication rules on %s", async mode => {
    const host = bindings();
    if (mode === "missing") host.read.mockResolvedValue(undefined);
    if (mode === "callback") host.read.mockRejectedValue(new Error("private-secret"));
    const input = mode === "invalid-schema" ? "not-a-field\n42\n" : '"Value,S,2","Message,A,20"\n42,record\n';
    const fs = Volume.fromJSON({ "/in.csv": input, "/out.db": "untouched" });
    const stderr: Uint8Array[] = []; let writes = 0;
    const engine = createEngine({ codecs: [], environment: context.environment,
      password: host.context.password, entropy: host.context.entropy,
      limits: { ...context.limits, ...(mode === "work" ? { workbookWork: 0 } : {}), ...(mode === "output" ? { outputBytes: 2047 } : {}) },
      filesystem: { cwd: "/", async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; },
        async write(path, bytes) { writes++; fs.writeFileSync(path, bytes); } } });
    try {
      const result = await runCommand(["-T", "Gnumeric_paradox:paradox", "-O", options[0]!, "/in.csv", "/out.db"], engine,
        { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(bytes); } } });
      expect(result.exitCode).toBe(mode === "success" ? 0 : 1);
      expect(Buffer.concat(stderr).toString()).not.toContain("private-secret");
      if (mode === "success") {
        expect(writes).toBe(1);
        const output = new Uint8Array(fs.readFileSync("/out.db") as Uint8Array);
        expect(new DataView(output.buffer).getUint32(92, true)).toBe(0x20e26198);
        expect((await readParadox(output, context)).sheets[0]!.cells.map(cell => cell.value))
          .toEqual([{ kind: "string", value: "Value,S,2" }, { kind: "string", value: "Message,A,20" },
            { kind: "number", value: 42 }, { kind: "string", value: "record" }]);
        expect(host.read.mock.calls[0]).toEqual([expect.objectContaining({ outputFilename: "/out.db", purpose: "encrypt" })]);
      } else {
        expect(writes).toBe(0); expect(fs.readFileSync("/out.db", "utf8")).toBe("untouched");
      }
    } finally { await engine.dispose(); }
  });
