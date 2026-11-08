import { describe, expect, it, vi } from "vitest";
import { transformOdfBlowfish } from "./odf-blowfish.js";
import { blowfishControls } from "./odf-blowfish-controls.js";
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16));
describe.each(["encrypt", "decrypt"] as const)("Blowfish CFB %s", direction => {
  it.each(blowfishControls)("matches independent CFB64 control $name", async vector => {
    const key = bytes(vector.key), iv = bytes(vector.iv), input = bytes(direction === "encrypt" ? vector.plaintext : vector.cfb64Ciphertext);
    const before = [new Uint8Array(key), new Uint8Array(iv), new Uint8Array(input)];
    expect(await transformOdfBlowfish(key, iv, input, new AbortController().signal, direction, 8))
      .toEqual(bytes(direction === "encrypt" ? vector.cfb64Ciphertext : vector.plaintext));
    expect([key, iv, input]).toEqual(before);
  });
  it.each(blowfishControls)("matches independent CFB8 control $name", async (vector) => {
    const key = bytes(vector.key), iv = bytes(vector.iv), ciphertext = bytes(vector.ciphertext);
    const before = [new Uint8Array(key), new Uint8Array(iv), new Uint8Array(ciphertext)];
    expect(await transformOdfBlowfish(key, iv, (direction === "encrypt" ? bytes(vector.plaintext) : ciphertext), new AbortController().signal, direction)).toEqual(direction === "encrypt" ? ciphertext : bytes(vector.plaintext));
    expect([key, iv, ciphertext]).toEqual(before);
  });
  it.each([1, 8] as const)("stops cancellation during %s-byte feedback", async feedbackBytes => {
    const signal = new AbortController().signal; let checks = 0;
    vi.spyOn(signal, "throwIfAborted").mockImplementation(() => { if (++checks === 600) throw new DOMException("Aborted", "AbortError"); });
    await expect(transformOdfBlowfish(new Uint8Array(16), new Uint8Array(8), new Uint8Array(8193), signal, direction, feedbackBytes)).rejects.toMatchObject({ name: "AbortError" });
    expect(checks).toBe(600);
  });
  it.each([1, 100])("stops cancellation at admitted primitive check %s", async (stop) => {
    const signal = new AbortController().signal; let checks = 0;
    vi.spyOn(signal, "throwIfAborted").mockImplementation(() => { if (++checks === stop) throw new DOMException("Aborted", "AbortError"); });
    await expect(transformOdfBlowfish(new Uint8Array(16), new Uint8Array(8), new Uint8Array(8193), signal, direction)).rejects.toMatchObject({ name: "AbortError" });
    expect(checks).toBe(stop);
  });
  it.each([1, 8] as const)("yields for cancellation within a long %s-byte feedback stream", async feedbackBytes => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 0);
    try { await expect(transformOdfBlowfish(new Uint8Array(16), new Uint8Array(8), new Uint8Array(8193), controller.signal, direction, feedbackBytes)).rejects.toMatchObject({ name: "AbortError" }); }
    finally { clearTimeout(timer); }
  });
});
