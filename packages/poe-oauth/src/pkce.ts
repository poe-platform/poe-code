import crypto from "node:crypto";

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(validateCodeVerifier(verifier)).digest("base64url");
}

export function validateCodeVerifier(verifier: string): string {
  if (
    verifier.length < 43 ||
    verifier.length > 128 ||
    !hasOnlyPkceCharacters(verifier)
  ) {
    throw new Error(
      "Poe OAuth codeVerifier must contain 43 to 128 URL-safe PKCE characters."
    );
  }
  return verifier;
}

export function validateCodeChallenge(challenge: string): string {
  if (challenge.length !== 43 || !hasOnlyPkceCharacters(challenge)) {
    throw new Error("Poe OAuth codeChallenge must contain 43 URL-safe PKCE characters.");
  }
  return challenge;
}

function hasOnlyPkceCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    if (!isDigit && !isUppercase && !isLowercase && character !== "-" && character !== "_") {
      return false;
    }
  }
  return true;
}
