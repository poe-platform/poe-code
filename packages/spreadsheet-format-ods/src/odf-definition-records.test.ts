import { expect, it, vi } from "vitest";
import { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import type { WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { createDefinitionRecords } from "./odf-definition-records.js";

function fixture(signal = new AbortController().signal) {
  const backing = new Uint8Array(100000), borrowed = new Uint8Array(4096); let next = 1;
  const storage: WorkingStorage = {
    allocate(length) { const address = next; next += length; expect(next).toBeLessThanOrEqual(backing.length); return address; },
    async read(address, length) { expect(length).toBeLessThanOrEqual(4096); borrowed.fill(0); borrowed.set(backing.subarray(address, address + length)); return borrowed.subarray(0, length); },
    async write(address, bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); backing.set(bytes, address); }, async close() {}
  };
  return { storage, records: createDefinitionRecords({ signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} }, storage) };
}
it("replays definition text through bounded borrowed reads without changing UTF-16 boundaries", async () => {
  const { records } = fixture(), text = "x".repeat(2047) + "🦀" + "é".repeat(6000), address = await records.putText(text);
  const record = await records.put([0, address, await records.putText("name")]);
  const stored = await records.get(record); expect(stored.slice(0, 2)).toEqual([0, address]);
  let actual = "";
  for await (const fragment of records.text(address)) { expect(fragment.length).toBeLessThanOrEqual(2048); actual += fragment; }
  expect(actual).toBe(text);
  let name = ""; for await (const fragment of records.text(stored[2])) name += fragment; expect(name).toBe("name");
});
it.each(["write", "cancel"])("erases definition text scratch after %s failure", async mode => {
  const controller = new AbortController(), reason = new Error("definition write"), { storage, records } = fixture(controller.signal);
  const write = storage.write; let captured: Uint8Array | undefined;
  vi.spyOn(storage, "write").mockImplementation(async (address, bytes) => {
    await write(address, bytes);
    if (bytes.length > 8) { captured = bytes; if (mode === "cancel") controller.abort(reason); else throw reason; }
  });
  await expect(records.putText("x".repeat(5000))).rejects.toBe(reason);
  expect(captured).toBeDefined(); expect(captured!.every(byte => byte === 0)).toBe(true);
});
it("does not yield text after cancellation during a borrowed storage read", async () => {
  const controller = new AbortController(), reason = new Error("definition read"), { storage, records } = fixture(controller.signal);
  const address = await records.putText("text"), read = storage.read;
  vi.spyOn(storage, "read").mockImplementation(async (position, length) => {
    const bytes = await read(position, length); if (position > address) controller.abort(reason); return bytes;
  });
  await expect(records.text(address).next()).rejects.toBe(reason);
});
