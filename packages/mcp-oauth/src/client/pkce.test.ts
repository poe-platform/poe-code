import { describe, expect, it } from "vitest";
import { generateCodeChallenge, generateCodeVerifier } from "../index.js";

function isUnreservedPkceCharacter(character: string): boolean {
  return (
    (character >= "A" && character <= "Z")
    || (character >= "a" && character <= "z")
    || (character >= "0" && character <= "9")
    || character === "-"
    || character === "."
    || character === "_"
    || character === "~"
  );
}

describe("PKCE helpers", () => {
  it("generates an RFC 7636-compliant code verifier", () => {
    const verifier = generateCodeVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect([...verifier].every(isUnreservedPkceCharacter)).toBe(true);
  });

  it("matches the RFC 7636 Appendix B S256 vector", () => {
    expect(
      generateCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
