import { expect, it } from "vitest";
import { createFormatRegistry } from "@poe-code/pandoc";
import type { FormatDescriptor } from "@poe-code/pandoc";

it("owns and freezes aliases in public format capability descriptors", () => {
  const aliases = { write: ["original"] };
  const descriptor: FormatDescriptor = {
    name: "example",
    aliases,
    read: false,
    write: true,
    media: "text",
    inputEncoding: "utf8",
    suffixes: ["example"],
    extensions: {},
    options: { read: [], write: [] }
  };
  const registry = createFormatRegistry([descriptor]);
  aliases.write.push("later");
  aliases.write = ["replacement"];

  const published = registry.capabilities[0]!;
  expect(published.aliases).toEqual({ write: ["original"] });
  expect(Object.isFrozen(published.aliases)).toBe(true);
  expect(Object.isFrozen(published.aliases!.write)).toBe(true);
  expect(registry.parse("original", "write").descriptor.aliases).toEqual({
    write: ["original"]
  });
  expect(() => registry.parse("later", "write")).toThrow();
  expect(() => registry.parse("replacement", "write")).toThrow();
});
