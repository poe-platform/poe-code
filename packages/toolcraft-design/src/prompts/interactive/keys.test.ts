import { describe, expect, it } from "vitest";
import { mapKey } from "./keys.js";

describe("mapKey", () => {
  it("maps arrows, aliases, enter, space, escape, and ctrl-c", () => {
    expect(mapKey("up", undefined)).toBe("up");
    expect(mapKey("j", "j")).toBe("down");
    expect(mapKey(undefined, "j")).toBe("down");
    expect(mapKey("return", "\r")).toBe("enter");
    expect(mapKey("space", " ")).toBe("space");
    expect(mapKey("escape", undefined)).toBe("cancel");
    expect(mapKey("c", "\x03")).toBe("cancel");
  });
});
