import { fileURLToPath } from "node:url";
import { Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { useNativeProcess } from "../tests/native-process.js";

const nativeRequest = useNativeProcess(["--expose-gc", fileURLToPath(new URL("../tests/fixtures/comment-drawing-native-depth.mjs", import.meta.url))]);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const depth of [32, 8192]) for (const route of ["model", "sdk", "cli"] as const)
for (const action of ["has_picture", "image"] as const)
describe(`comment Drawing inspects admitted inert native extensions without main-host recursion; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}; action=${action}`, () => {
  let fixture: { memory: Volume; input: Uint8Array };
  beforeEach(async () => {
    const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const drawing = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const initial = await textFixture('<w:p><w:r><w:t>Retained 海🌊</w:t></w:r></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${word}"/>` } }, strict, { kind });
    const limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 1048576, maxTotalBytes: 1048576, maxRetainedBytes: 2147483648 };
    const memory = Volume.fromJSON({ "/input": Buffer.from(initial) });
    const input = initial;
    fixture = { memory, input };
    expect(await nativeRequest({ phase: "prepare", limits, route, action, depth, word, drawing, base64: Buffer.from(input).toString("base64") })).toEqual({ ok: true, phase: "prepare" });
  }, 30000);

  // Qualify native preparation, public execution and archive readback separately.
  // Native integration deadlines include shared-machine scheduling delays.
  it("executes the public native Drawing workflow", async () => {
    const result = await nativeRequest({ phase: "execute" });
    expect(result).toMatchObject({ ok: true, phase: "execute" });
    if (action === "has_picture") {
      expect(result).toMatchObject({ oneDrawing: true, value: false });
      if (route === "sdk") expect(result).toMatchObject({ unchangedEffects: true });
      if (route === "cli") expect(result).toMatchObject({ exitCode: 0 });
    } else {
      expect(result).toMatchObject({ code: "missing-selection" });
      if (route === "model" || route === "sdk") expect(result).toMatchObject({ expectedType: true });
      else expect(result).toMatchObject({ zeroEffects: true });
    }
  }, 30000);

  afterEach(async () => {
    try {
      const result = await nativeRequest({ phase: "verify" });
      expect(result).toMatchObject({ ok: true, phase: "verify", exactInput: true });
      if (action === "has_picture" && (route !== "sdk" || depth === 32)) expect(result).toMatchObject({ exactMembers: true });
      if (route === "cli") {
        expect(result).toMatchObject({ sourceRetained: true });
        if (action === "image") expect(result).toMatchObject({ destinationRetained: true });
      }
      expect((fixture.memory.readFileSync("/input") as Buffer).equals(Buffer.from(fixture.input))).toBe(true);
    } finally { fixture = undefined!; }
  }, 30000);
});
