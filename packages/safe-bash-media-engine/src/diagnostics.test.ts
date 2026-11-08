import { expect, it } from "vitest";
import { comparableDiagnostics } from "../integration/diagnostics.js";
it("normalizes only native log context addresses, preserving raw bytes and message text", () => {
  const value = Buffer.concat([Buffer.from("[in#0 @ 0xabcdef] Error: filename @ 0x123\n"), Buffer.from([255]), Buffer.from("\nplain 0xab\n")]);
  expect(comparableDiagnostics(value)).toEqual(Buffer.concat([Buffer.from("[in#0 @ <address>] Error: filename @ 0x123\n"), Buffer.from([255]), Buffer.from("\nplain 0xab\n")]));
  expect(comparableDiagnostics(Buffer.from("[x @ 0xnothex] text"))).toEqual(Buffer.from("[x @ 0xnothex] text"));
});
