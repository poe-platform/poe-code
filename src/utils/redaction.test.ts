import { describe, expect, it } from "vitest";
import { redactHttpBodyText, redactSecretString, redactSecrets } from "./redaction.js";

describe("redaction", () => {
  it("redacts bare provider token shapes inside ordinary strings", () => {
    const text = "Invalid API key sk-live-1234567890 for request";

    expect(redactSecretString(text)).toBe("Invalid API key [redacted] for request");
  });

  it("redacts bare token shapes inside non-sensitive JSON fields", () => {
    const redacted = redactHttpBodyText(
      JSON.stringify({
        detail: "Gateway echoed token sk-proj-abcdefghijklmnopqrstuvwxyz in detail",
        error: "Invalid API key sk-live-1234567890 for request"
      })
    );

    expect(redacted).toContain('"error":"Invalid API key [redacted] for request"');
    expect(redacted).toContain('"detail":"Gateway echoed token [redacted] in detail"');
    expect(redacted).not.toContain("sk-live-1234567890");
    expect(redacted).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
  });

  it("does not redact unrelated short sk-prefixed words", () => {
    expect(redactSecretString("sketch-123 and sk-short remain visible")).toBe(
      "sketch-123 and sk-short remain visible"
    );
  });

  it("redacts nested bare tokens in generic structured fields", () => {
    const redacted = redactSecrets({
      message: "GitHub rejected ghp_abcdefghijklmnopqrstuvwxyz1234"
    });

    expect(redacted).toEqual({
      message: "GitHub rejected [redacted]"
    });
  });
});
