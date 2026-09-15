import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { createObjectBackend } from "./backend.js";
import { generateOtp } from "./otp.js";
import type { OpItem } from "./types.js";

async function withGlobalCrypto(value: unknown, operation: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value });
  try { await operation(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
}

test("Node backend construction and distinct binding identities do not require global crypto", async () => {
  await withGlobalCrypto(undefined, async () => {
    const first = createObjectBackend();
    const second = createObjectBackend();
    const request = { resource: "vault", action: "list", args: [], flags: {} };
    const context = { signal: new AbortController().signal };
    const firstBinding = await first.prepareBinding([request], context);
    const secondBinding = await second.prepareBinding([request], context);
    assert.equal(firstBinding.backendId.length, 36);
    assert.notEqual(firstBinding.backendId, secondBinding.backendId);
    assert.equal(globalThis.crypto, undefined);
    first.cancelBinding(firstBinding.handle);
    second.cancelBinding(secondBinding.handle);
  });
});

test("Node password generation uses native secure randomness without global crypto", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "work", name: "Workspace" }] });
  await withGlobalCrypto(undefined, async () => {
    const item = await backend.execute({ resource: "item", action: "create", args: [], flags: { category: "LOGIN", "generate-password": "digits,32" } }, { signal: new AbortController().signal }) as OpItem;
    const password = item.fields?.find(field => field.id === "password")?.value;
    assert.equal(typeof password, "string");
    assert.equal(password?.length, 32);
    assert.ok([...String(password)].every(character => "0123456789".includes(character)));
    assert.equal(globalThis.crypto, undefined);
  });
});

test("Node OTP matches RFC 6238 without global crypto", async () => {
  await withGlobalCrypto(undefined, async () => {
    assert.equal(await generateOtp("otpauth://totp/Example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8", 59000), "94287082");
    assert.equal(globalThis.crypto, undefined);
  });
});

test("browser crypto exports the host native provider and fails closed when absent", async () => {
  await withGlobalCrypto(webcrypto, async () => {
    const module = await import(new URL("./crypto-browser.js?available", import.meta.url).href);
    assert.equal(module.opCrypto, webcrypto);
  });
  await withGlobalCrypto(undefined, async () => {
    await assert.rejects(import(new URL("./crypto-browser.js?unavailable", import.meta.url).href), { message: "Secure Web Crypto is required for op" });
    assert.equal(globalThis.crypto, undefined);
  });
});
