import { expect, it } from "vitest";
import { useNativeProcess } from "../tests/native-process.js";

const execute = useNativeProcess(["--import", "tsx", "packages/docx/tests/fixtures/bookmark-depth-public.ts"]);

// A normal Node host has a smaller stack than Vitest's worker. The child uses
// memfs only and the public exports; explicit depth ceilings are caller authority.
for (const strict of [false, true]) for (const depth of [32, 4096])
for (const action of ["read", "rename", "remove"] as const) for (const route of ["sdk", "cli"])
it(`public bookmark ${action} retains native graph at admitted depth ${depth}; strict=${strict}; ${route}`, async () => {
  const data = await execute({ strict, depth, action, route }) as { ok: boolean; stack?: string };
  expect(data, data.stack).toEqual({ ok: true, strict, depth, action, route });
});
