const nativeCrypto = globalThis.crypto;
if (typeof nativeCrypto?.getRandomValues !== "function" || typeof nativeCrypto.randomUUID !== "function" || typeof nativeCrypto.subtle?.importKey !== "function" || typeof nativeCrypto.subtle.sign !== "function") {
  throw new Error("Secure Web Crypto is required for op");
}

export const opCrypto = nativeCrypto;
