import { beforeEach, expect, it, vi } from "vitest";
import { readPackage } from "./assertions.js";

const host = vi.hoisted(() => ({ enabled: true, crc32: vi.fn(() => 0xcbf43926) }));
vi.mock("node:zlib", async original => ({
  ...await original<typeof import("node:zlib")>(),
  get crc32() { return host.enabled ? host.crc32 : undefined; }
}));

// ZIP32 framing around the published CRC-32 check vector, independently of the codec.
function checkVector() {
  const payload = new TextEncoder().encode("123456789"), name = new TextEncoder().encode("check");
  const central = 30 + name.length + payload.length, end = central + 46 + name.length;
  const bytes = new Uint8Array(end + 22), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(14, 0xcbf43926, true);
  view.setUint32(18, payload.length, true);
  view.setUint32(22, payload.length, true);
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);
  bytes.set(payload, 30 + name.length);
  view.setUint32(central, 0x02014b50, true);
  view.setUint32(central + 16, 0xcbf43926, true);
  view.setUint32(central + 20, payload.length, true);
  view.setUint32(central + 24, payload.length, true);
  view.setUint16(central + 28, name.length, true);
  bytes.set(name, central + 46);
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, end - central, true);
  view.setUint32(end + 16, central, true);
  return { bytes, payload };
}

beforeEach(() => {
  host.enabled = true;
  host.crc32.mockReset().mockReturnValue(0xcbf43926);
});

it("uses the independent native checksum when the host provides it", () => {
  const { bytes, payload } = checkVector();
  expect(readPackage(bytes).get("check")).toEqual(payload);
  expect(host.crc32).toHaveBeenCalledExactlyOnceWith(payload);
  host.crc32.mockReturnValueOnce(0);
  expect(() => readPackage(bytes)).toThrow("ZIP payload CRC");
});

it("retains the independent bitwise witness on older Node hosts", () => {
  host.enabled = false;
  const { bytes, payload } = checkVector();
  expect(readPackage(bytes).get("check")).toEqual(payload);
  bytes[35] = bytes[35]! ^ 1;
  expect(() => readPackage(bytes)).toThrow("ZIP payload CRC");
  expect(host.crc32).not.toHaveBeenCalled();
});
