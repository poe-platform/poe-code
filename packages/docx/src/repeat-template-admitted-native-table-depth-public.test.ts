import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, onTestFinished } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;

type NativeResponse = { type: "result"; id: number; ok: boolean; output?: string; error?: string; stack?: string };
let child: ReturnType<typeof spawn>;
let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
let pending: { id: number; resolve: (value: NativeResponse) => void; reject: (error: Error) => void } | undefined;
let rejectReady: ((error: Error) => void) | undefined;
let fatal: Error | undefined;
let nextId = 0, ready = false, stopping = false, acknowledged = false;
let stderr = "";

function failNative(error: Error): void {
  fatal ??= error;
  rejectReady?.(fatal);
  pending?.reject(fatal);
  pending = undefined;
  child?.kill("SIGKILL");
}

beforeAll(async () => {
  child = spawn(process.execPath, [fileURLToPath(new URL("../tests/fixtures/repeat-template-native.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let resolveReady: () => void;
  const startup = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  closed = new Promise(resolve => child.on("close", (code, signal) => {
    if (!stopping || !acknowledged || pending || code !== 0 || signal !== null)
      failNative(new Error(`Native child closed incompletely: code=${code}, signal=${signal}\n${stderr}`));
    resolve({ code, signal });
  }));
  child.stderr!.setEncoding("utf8").on("data", bytes => { stderr += bytes; });
  child.stdout!.on("data", () => { failNative(new Error("Unexpected native stdout outside its response")); });
  child.on("error", failNative);
  child.on("message", message => {
    if (!message || typeof message !== "object") return failNative(new Error("Invalid native response"));
    const response = message as { type?: string; id?: number };
    if (response.type === "ready" && !ready && !stopping && !fatal) {
      ready = true;
      resolveReady();
    } else if (response.type === "closed" && stopping && !acknowledged && !pending && response.id === nextId) {
      acknowledged = true;
    } else if (response.type === "result" && ready && !stopping && pending !== undefined && pending.id === response.id) {
      const completed = pending;
      pending = undefined;
      completed.resolve(message as NativeResponse);
    } else failNative(new Error("Duplicate, mismatched or unexpected native response"));
  });
  const timer = setTimeout(() => { failNative(new Error("Native child did not become ready")); }, 5000);
  try { await startup; }
  catch (error) { failNative(error as Error); await closed; throw error; }
  finally { clearTimeout(timer); }
});

afterAll(async () => {
  if (!child) return;
  if (!fatal) {
    if (pending) failNative(new Error("Native request unfinished at shutdown"));
    else {
      stopping = true;
      child.send({ type: "shutdown", id: nextId }, error => { if (error) failNative(error); });
    }
  }
  const timer = setTimeout(() => { failNative(new Error("Native child did not finish shutdown")); }, 5000);
  let outcome: Awaited<typeof closed>;
  try { outcome = await closed; } finally { clearTimeout(timer); }
  if (fatal) throw fatal;
  expect(acknowledged).toBe(true);
  expect(outcome).toEqual({ code: 0, signal: null });
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [1, 1024, 2048])
for (const operation of ["controls.repeat", "template.apply"] as const)
for (const route of ["native-sdk", "native-sdk-batch", "native-cli", "native-cli-batch"] as const)
it(`repeat/template admitted nested native table depth; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; operation=${operation}; route=${route}`, async () => {
  const controller = new AbortController();
  let finished = false, requestId: number | undefined;
  onTestFinished(async () => {
    finished = true;
    controller.abort();
    if (requestId !== undefined && pending?.id === requestId) {
      failNative(new Error("Native matrix case ended with an unfinished request"));
      await closed;
    }
  });
  if (fatal) throw fatal;
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 }, signal = controller.signal;
  const fresh = () => ({ signal, limits, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const });
  const field = '<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="entry"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>';
  const head = '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p/>', tail = '<w:p/></w:tc></w:tr></w:tbl>';
  const tables = head.repeat(depth) + '<w:p>' + field + '</w:p>' + tail.repeat(depth);
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${tables}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}" xmlns:f="urn:original:repeat-physical-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:pPr></w:pPr><w:r><w:t>Outside</w:t></w:r></w:p>${region}<!--retained--><?audit exact?></w:body></w:document>`));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const allowed = true;
  if (fatal) throw fatal;
  if (finished || !ready || stopping || pending) throw new Error("Native child is not available for this case");
  const observed = await new Promise<NativeResponse>((resolve, reject) => {
    const id = ++nextId;
    requestId = id;
    pending = { id, resolve, reject };
    child.send({ type: "execute", id, input: Buffer.from(input).toString("base64"), route, operation, limits, documentLimits, allowed },
      error => { if (error) failNative(error); });
  });
  expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true });
  memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
  if (allowed) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits); expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
    const main = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be").decode(after.get("word/document.xml")); expect(main.split("<w:tbl>").length - 1).toBe(depth); expect(main).toContain('<w:tblW w:w="2400" w:type="dxa"/>'); expect(main).toContain("<!--retained--><?audit exact?>");
    expect((await api.extractDocumentText(output, fresh())).text).toBe("Outside\n" + "\n".repeat(depth) + "New 海🌊" + "\n".repeat(depth));
    expect((await api.validateDocument(output, fresh())).valid).toBe(true);
    expect((await api.inspectDocumentControls(output, {}, fresh())).items.find(item => item.tag === "entry")).toMatchObject({ value: "New 海🌊", placeholder: false });
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect([...readPackage(input, limits).keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of readPackage(input, limits)) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(parts.get(name)!)), name).toBe(0);
});
