import { Volume } from "memfs";
import { expect, it, onTestFinished } from "vitest";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const api = await compiledPublicRuntime;
const execute = nativeRepeatTemplate();
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [32, 8192]) for (const placement of ["unrelated", "selected"] as const)
for (const operation of ["controls.repeat", "template.apply"] as const) {
  const label = `repeat/template physical depth ${placement}; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; operation=${operation}`;
  const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
  const fresh = (signal: AbortSignal) => ({ signal, limits, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const });
  const allowed = placement === "unrelated";
  const retained = '<f:opaque>' + '<f:owner>'.repeat(depth) + '<f:leaf/>' + '</f:owner>'.repeat(depth) + '</f:opaque>';
  const affected = '<w:futureProperty>' + '<w:futureChild>'.repeat(depth) + '<w:leaf/>' + '</w:futureChild>'.repeat(depth) + '</w:futureProperty>';
  const field = '<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="entry"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>';
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field}${placement === "selected" ? affected : ""}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  async function fixture(signal: AbortSignal) {
    const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
    parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}" xmlns:f="urn:original:repeat-physical-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:pPr>${placement === "unrelated" ? retained : ""}</w:pPr><w:r><w:t>Outside</w:t></w:r></w:p>${region}<!--retained--><?audit exact?></w:body></w:document>`));
    if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
    const memory = Volume.fromJSON({ "/input": "", "/output": "" });
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, fresh(signal).encoding, fresh(signal));
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
    return { parts, input, original };
  }
  function assertInput(input: Uint8Array, original: Uint8Array, parts: Map<string, Uint8Array>) {
    expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect([...readPackage(input, limits).keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of readPackage(input, limits)) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(parts.get(name)!)), name).toBe(0);
  }
  let baseline: { output: Uint8Array; input: Uint8Array } | undefined;
  const checks = ["text", "controls"] as const, verified = new Set<string>();

  if (allowed) {
    it(`${label}; baseline=request`, async () => {
      const controller = new AbortController();
      let cleaned = false;
      const admitted: { candidate?: { output: Uint8Array; input: Uint8Array; receipt: { readonly drained: boolean } } } = {};
      onTestFinished(({ task }) => {
        if (task.result?.state === "pass" && cleaned && admitted.candidate?.receipt.drained) baseline = admitted.candidate;
      });
      onTestFinished(() => { controller.abort(); cleaned = true; });
      const { parts, input, original } = await fixture(controller.signal);
      controller.signal.throwIfAborted();
      const observed = await execute({ input: Buffer.from(input).toString("base64"), route: "native-sdk", operation, limits, documentLimits, allowed });
      expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true });
      const output = new Uint8Array(Buffer.from(observed.output!, "base64"));
      const after = readPackage(output, limits); expect([...after.keys()]).toEqual([...parts.keys()]);
      for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
      const main = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be").decode(after.get("word/document.xml")); expect(main).toContain(retained); expect(main).toContain("<!--retained--><?audit exact?>");
      assertInput(input, original, parts);
      admitted.candidate = { output, input: input.slice(), receipt: observed.receipt };
    });

    for (const check of checks) it(`${label}; baseline=${check}`, async () => {
      const controller = new AbortController();
      let completed = false, cleaned = false;
      onTestFinished(({ task }) => {
        if (task.result?.state === "pass" && completed && cleaned) verified.add(check);
      });
      onTestFinished(() => { controller.abort(); cleaned = true; });
      if (!baseline) throw new Error("Native baseline request did not complete successfully");
      const output = baseline.output, original = output.slice();
      if (check === "text") expect((await api.extractDocumentText(output, fresh(controller.signal))).text).toBe("Outside\nNew 海🌊");
      else expect((await api.inspectDocumentControls(output, {}, fresh(controller.signal))).items.find(item => item.tag === "entry")).toMatchObject({ value: "New 海🌊", placeholder: false });
      expect(Buffer.compare(Buffer.from(output), Buffer.from(original))).toBe(0);
      completed = true;
    });
  }

  for (const route of ["native-sdk", "native-sdk-batch", "native-cli", "native-cli-batch"] as const)
  it(`${label}; route=${route}`, async () => {
    const controller = new AbortController();
    onTestFinished(() => { controller.abort(); });
    if (allowed && (!baseline || !checks.every(check => verified.has(check)))) throw new Error("Native baseline semantics and cleanup are incomplete");
    const { parts, input, original } = await fixture(controller.signal);
    controller.signal.throwIfAborted();
    if (allowed) expect(Buffer.compare(Buffer.from(input), Buffer.from(baseline!.input))).toBe(0);
    const observed = await execute({ input: Buffer.from(input).toString("base64"), route, operation, limits, documentLimits, allowed });
    expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true });
    const output = new Uint8Array(Buffer.from(observed.output!, "base64"));
    if (allowed) expect(Buffer.compare(Buffer.from(output), Buffer.from(baseline!.output))).toBe(0);
    else expect(output.byteLength).toBe(0);
    assertInput(input, original, parts);
  });
}
