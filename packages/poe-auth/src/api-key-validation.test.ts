import { describe, expect, it } from "vitest";
import { isValidApiKeyFormat, normalizeApiKey, stripBracketedPaste } from "./api-key-validation.js";

describe("stripBracketedPaste", () => {
  it("removes bracketed paste escape sequences", () => {
    expect(stripBracketedPaste("\u001b[200~sk-poe-abc123\u001b[201~")).toBe("sk-poe-abc123");
  });

  it("removes trailing mangled paste artifacts", () => {
    expect(stripBracketedPaste("sk-poe-abc123undefinedndefined")).toBe("sk-poe-abc123");
  });

  it("removes each known trailing paste artifact", () => {
    expect(stripBracketedPaste("sk-poe-abc123undefined")).toBe("sk-poe-abc123");
    expect(stripBracketedPaste("sk-poe-abc123ndefined")).toBe("sk-poe-abc123");
  });
});

describe("isValidApiKeyFormat", () => {
  it("accepts raw keys with allowed separators at minimum length", () => {
    expect(isValidApiKeyFormat("abcd_efgh-ijkl_mnop-qrst_uvwx-yz12")).toBe(true);
  });

  it("accepts sk-poe prefixed keys with alphanumeric hash", () => {
    expect(isValidApiKeyFormat("sk-poe-abcdefghijklmnopqrstuvwxyz12345678")).toBe(true);
  });

  it("rejects keys shorter than the minimum length", () => {
    expect(isValidApiKeyFormat("abc-def_ghi-jkl_mno-pqr_stu-vwx")).toBe(false);
  });

  it("rejects prefixed keys whose hash is shorter than the minimum length", () => {
    expect(isValidApiKeyFormat("sk-poe-abcdefghijklmnopqrstuvwxyz1234567")).toBe(false);
  });

  it("rejects raw keys with invalid characters", () => {
    expect(isValidApiKeyFormat("abcd_efgh-ijkl.mnop-qrst_uvwx-yz12")).toBe(false);
  });

  it("rejects prefixed keys with non-alphanumeric hash characters", () => {
    expect(isValidApiKeyFormat("sk-poe-abc_defghijklmnopqrstuvwxyz12")).toBe(false);
  });
});

describe("normalizeApiKey", () => {
  it("trims and strips bracketed paste artifacts", () => {
    expect(
      normalizeApiKey("  \u001b[200~sk-poe-abcdefghijklmnopqrstuvwxyz12345678\u001b[201~  ")
    ).toBe("sk-poe-abcdefghijklmnopqrstuvwxyz12345678");
  });

  it("throws when the key is empty after normalization", () => {
    expect(() => normalizeApiKey("  ")).toThrowError("POE API key cannot be empty.");
  });

  it("throws when the key format is invalid", () => {
    expect(() => normalizeApiKey("invalid key")).toThrowError("POE API key format is invalid.");
  });
});
