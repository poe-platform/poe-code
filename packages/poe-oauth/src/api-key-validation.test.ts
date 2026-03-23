import { describe, expect, it } from "vitest";
import { isValidApiKeyFormat, normalizeApiKey, stripBracketedPaste } from "./api-key-validation.js";

describe("stripBracketedPaste", () => {
  it("removes bracketed paste escape sequences", () => {
    expect(stripBracketedPaste("\u001b[200~sk-poe-abc123\u001b[201~")).toBe("sk-poe-abc123");
  });

  it("leaves plain input unchanged", () => {
    expect(stripBracketedPaste("sk-poe-abc123")).toBe("sk-poe-abc123");
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
  it("accepts raw keys at the exact minimum length", () => {
    expect(isValidApiKeyFormat("abcd_efgh-ijkl_mnop-qrst_uvwx-yz12")).toBe(true);
  });

  it("accepts longer raw keys with allowed separators", () => {
    expect(isValidApiKeyFormat("abcd_efgh-ijkl_mnop-qrst_uvwx-yz12_abcd")).toBe(true);
  });

  it("accepts sk-poe prefixed keys at the exact minimum hash length", () => {
    expect(isValidApiKeyFormat("sk-poe-abcdefghijklmnopqrstuvwxyz12345678")).toBe(true);
  });

  it("accepts sk-poe prefixed keys with alphanumeric hash", () => {
    expect(isValidApiKeyFormat("sk-poe-abcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
  });

  it("accepts sk-poe prefixed keys with hyphens and underscores in hash", () => {
    expect(isValidApiKeyFormat("sk-poe-abcdefghi_jklmnop-qrstuvwxyz1234567890")).toBe(true);
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

  it("rejects raw keys made only of separators", () => {
    expect(isValidApiKeyFormat("----------------------------------")).toBe(false);
    expect(isValidApiKeyFormat("__________________________________")).toBe(false);
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

  it("removes trailing paste artifacts before final trimming", () => {
    expect(normalizeApiKey("  sk-poe-abcdefghijklmnopqrstuvwxyz12345678undefined  ")).toBe(
      "sk-poe-abcdefghijklmnopqrstuvwxyz12345678"
    );
  });

  it("throws when the key is empty after normalization", () => {
    expect(() => normalizeApiKey("  ")).toThrowError("POE API key cannot be empty.");
  });

  it("throws when the key format is invalid", () => {
    expect(() => normalizeApiKey("invalid key")).toThrowError("POE API key format is invalid.");
  });

  it("throws when normalized raw input only contains separators", () => {
    expect(() => normalizeApiKey("  ----------------------------------  ")).toThrowError(
      "POE API key format is invalid."
    );
  });
});
