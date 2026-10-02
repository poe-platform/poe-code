import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "jose";

export function generateCodeVerifier(): string {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url.encode(sha256(new TextEncoder().encode(verifier)));
}
