import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useNativeProcess } from "../tests/native-process.js";

import { textContext, textFixture } from "../tests/fixtures/text.js";

const execute = useNativeProcess(["packages/docx/tests/fixtures/bookmark-depth-public.mjs"]);

// A normal Node host has a smaller stack than Vitest's worker. The child uses
// memfs only and the public exports; explicit depth ceilings are caller authority.
for (const strict of [false, true]) for (const depth of [32, 4096])
for (const action of ["read", "rename", "remove"] as const) for (const route of ["sdk", "cli"])
describe(`public bookmark ${action} retains native graph at admitted depth ${depth}; strict=${strict}; ${route}`, async () => {
  beforeEach(async () => {
    const base = await textFixture('<w:p><w:bookmarkStart w:id="11" w:name="Coast"/><w:r><w:rPr><w:b/></w:rPr><w:t>Target é 海</w:t></w:r><w:bookmarkEnd w:id="11"/></w:p><w:sectPr/>', {}, strict);
    expect(await execute({ phase: "prepare", strict, depth, action, route, base: Buffer.from(base).toString("base64"), limits: textContext.limits })).toEqual({ ok: true, strict, depth, action, route });
  }, 5000);
  it("retains the admitted bookmark graph", async () => {
    const data = await execute({ phase: "execute" }) as { ok: boolean; stack?: string };
    expect(data, data.stack).toEqual({ ok: true, strict, depth, action, route });
  });
  afterEach(async () => {
    const data = await execute({ phase: "verify" }) as { ok: boolean; stack?: string };
    expect(data, data.stack).toEqual({ ok: true, strict, depth, action, route });
  }, 5000);
});
