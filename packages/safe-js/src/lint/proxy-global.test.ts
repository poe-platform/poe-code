import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it.each([
  ['const p = new Proxy({answer: 42}, {}); return p.answer;', 42],
  ['const r = Proxy.revocable({answer: 42}, {}); r.revoke(); try { return r.proxy.answer; } catch (e) { return e.name; }', 'TypeError']
] as const)("accepts implemented Proxy behavior: %s", async (source, expected) => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
  expect(lint(source)).toEqual([]);
});

it("warns about local Proxy shadowing", () => {
  expect(lint('const Proxy = 1; return Proxy;')).toEqual([
    expect.objectContaining({code: "AS-SHADOW-GLOBAL", severity: "warning"})
  ]);
});

it("still rejects misspelled Proxy references", () => {
  expect(lint('return Prox;')).toEqual([
    expect.objectContaining({code: "AS003", severity: "error"})
  ]);
});
