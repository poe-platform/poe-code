import { expect, it } from "vitest";
import { createRegistry, type Codec } from "./codecs.js";

const read: NonNullable<Codec["read"]> = async () => ({ sheets: [] });
const write: NonNullable<Codec["write"]> = async () => new Uint8Array();

it("does not select an importer solely from a filename extension", () => {
  const registry = createRegistry([{ id: "fixture", description: "Fixture", extensions: ["xlsx"], read }]);
  expect(registry.select("read", undefined, "misleading.xlsx")).toBeUndefined();
});

it("allows separate installed opener and saver entries sharing the stable ID", () => {
  const registry = createRegistry([
    { id: "Gnumeric_Excel:xlsx", description: "Opener", extensions: ["xlsx"], read },
    { id: "Gnumeric_Excel:xlsx", description: "Saver", extensions: ["xlsx"], write }
  ]);
  expect(registry.select("read", "Gnumeric_Excel:xlsx")?.read).toBe(read);
  expect(registry.select("read", "Gnumeric_Excel:xlsx")?.description).toBe("ECMA 376 / Office Open XML [MS Excel™ 2007/2010] (*.xlsx)");
  expect(registry.select("write", "Gnumeric_Excel:xlsx")?.write).toBe(write);
  expect(registry.select("write", "Gnumeric_Excel:xlsx")?.description).toBe("ECMA 376 1st edition (2006); [MS Excel™ 2007]");
});
