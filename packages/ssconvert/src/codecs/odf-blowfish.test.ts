import { expect, it, vi } from "vitest";
import { decryptOdfBlowfish } from "./odf-blowfish.js";
import { blowfishControls } from "./odf-blowfish-controls.js";
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16));
it.each(blowfishControls)("matches independent CFB8 control $name", async (vector) => {
  const key = bytes(vector.key), iv = bytes(vector.iv), ciphertext = bytes(vector.ciphertext);
  const before = [new Uint8Array(key), new Uint8Array(iv), new Uint8Array(ciphertext)];
  expect(await decryptOdfBlowfish(key, iv, ciphertext, new AbortController().signal)).toEqual(bytes(vector.plaintext));
  expect([key, iv, ciphertext]).toEqual(before);
});
it.each([1, 100, 600])("stops cancellation at admitted primitive check %s", async (stop) => {
  const signal = new AbortController().signal; let checks = 0;
  vi.spyOn(signal, "throwIfAborted").mockImplementation(() => { if (++checks === stop) throw new DOMException("Aborted", "AbortError"); });
  await expect(decryptOdfBlowfish(new Uint8Array(16), new Uint8Array(8), new Uint8Array(8193), signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(checks).toBe(stop);
});
it("yields for cancellation within a long feedback stream", async () => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 0);
  try { await expect(decryptOdfBlowfish(new Uint8Array(16), new Uint8Array(8), new Uint8Array(8193), controller.signal)).rejects.toMatchObject({ name: "AbortError" }); }
  finally { clearTimeout(timer); }
});
