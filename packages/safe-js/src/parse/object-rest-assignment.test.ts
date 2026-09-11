import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { parse } from "../parse.js";

describe("object rest assignment targets", () => {
  it.each([
    "({...target.value} = source)",
    "({...target[key()]} = source)",
    "({...target().value} = source)",
    "({first, ...target.value} = source)",
    "({...((target?.value)).x} = source)",
    "({...target[key?.value].x} = source)"
  ])("accepts native-valid member targets: %s", (source) => {
    expect(() => new Script(source)).not.toThrow();
    expect(() => parse(source)).not.toThrow();
  });
  it.each([
    "const {...target.value} = source",
    "({...target?.value} = source)",
    "({...target()} = source)",
    "({...{value}} = source)",
    "({...target.value,} = source)",
    "({...target?.value.x} = source)",
    "({...target?.[key].x} = source)",
    "({...target?.().x} = source)"
  ])("rejects native-invalid rest targets: %s", (source) => {
    expect(() => new Script(source)).toThrow();
    expect(() => parse(source)).toThrow();
  });
});
