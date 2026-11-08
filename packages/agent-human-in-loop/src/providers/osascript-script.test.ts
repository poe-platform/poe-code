import { describe, expect, it } from "vitest";

import {
  buildScript,
  escapeAppleScriptString,
  parseStdout,
} from "./osascript-script.js";

describe("escapeAppleScriptString", () => {
  it("returns an empty string unchanged", () => {
    expect(escapeAppleScriptString("")).toBe("");
  });

  it("escapes backslashes before quotes", () => {
    expect(escapeAppleScriptString('a "b" \\ c')).toBe('a \\"b\\" \\\\ c');
  });

  it("escapes existing backslashes before escaping inserted quote backslashes", () => {
    expect(escapeAppleScriptString('"')).toBe('\\"');
  });
});

describe("buildScript", () => {
  it("builds the single-dialog script when no decline reason is requested", () => {
    expect(buildScript({ message: "hi" }, "T")).toMatchInlineSnapshot(
      `"button returned of (display dialog "hi" with title "T" buttons {"Decline","Approve"} default button "Approve")"`,
    );
  });

  it("builds the two-stage script when a decline reason is requested", () => {
    expect(
      buildScript({ message: "m", declineInputPrompt: "why?" }, "T"),
    ).toMatchInlineSnapshot(`
      "set firstResp to button returned of (display dialog "m" with title "T" buttons {"Decline","Approve"} default button "Approve")
      if firstResp is "Approve" then
        return "APPROVED"
      end if
      try
        set reason to text returned of (display dialog "why?" default answer "" with title "T" buttons {"Cancel","Submit"} default button "Submit")
        return "DECLINED:" & reason
      on error number -128
        return "DECLINED:"
      end try"
    `);
  });

  it("round-trips quotes and backslashes through the script snapshot", () => {
    expect(buildScript({ message: 'a "b" \\ c' }, "T")).toMatchInlineSnapshot(
      `"button returned of (display dialog "a \\"b\\" \\\\ c" with title "T" buttons {"Decline","Approve"} default button "Approve")"`,
    );
  });
});

describe("parseStdout", () => {
  it('parses "Approve" as approved', () => {
    expect(parseStdout("Approve\n")).toEqual({ outcome: "approved" });
  });

  it('parses "Approve" terminated with CRLF as approved', () => {
    expect(parseStdout("Approve\r\n")).toEqual({ outcome: "approved" });
  });

  it("parses output terminated with a bare carriage return", () => {
    expect(parseStdout("APPROVED\r")).toEqual({ outcome: "approved" });
    expect(parseStdout("Approve\r")).toEqual({ outcome: "approved" });
    expect(parseStdout("DECLINED:reason\r")).toEqual({
      outcome: "declined",
      reason: "reason",
    });
  });

  it('parses "Decline" as declined without a reason', () => {
    expect(parseStdout("Decline\n")).toEqual({ outcome: "declined" });
  });

  it('parses "APPROVED" as approved', () => {
    expect(parseStdout("APPROVED\n")).toEqual({ outcome: "approved" });
  });

  it('parses "DECLINED:foo" as declined with a reason', () => {
    expect(parseStdout("DECLINED:foo\n")).toEqual({
      outcome: "declined",
      reason: "foo",
    });
  });

  it("preserves a trailing newline in a decline reason", () => {
    expect(parseStdout("DECLINED:line one\n\n")).toEqual({
      outcome: "declined",
      reason: "line one\n",
    });
  });

  it("preserves colons inside a decline reason", () => {
    expect(parseStdout("DECLINED:foo:bar\n")).toEqual({
      outcome: "declined",
      reason: "foo:bar",
    });
  });

  it('parses "DECLINED:" as declined without a reason key', () => {
    const result = parseStdout("DECLINED:\n");

    expect(result).toEqual({ outcome: "declined" });
    expect("reason" in result).toBe(false);
  });

  it("accepts approved output without a trailing newline", () => {
    expect(parseStdout("APPROVED")).toEqual({ outcome: "approved" });
  });

  it("throws on unexpected output and includes the raw value", () => {
    expect(() => parseStdout("weird\n")).toThrowError(
      "unexpected osascript output: weird\n",
    );
  });
});
