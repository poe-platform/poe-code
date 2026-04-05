import { describe, expect, it } from "vitest";
import {
  createSessionStore,
  defaultSessionIdGenerator,
} from "./session.js";

describe("session", () => {
  it("SS1: defaultSessionIdGenerator() returns non-empty string", () => {
    expect(defaultSessionIdGenerator()).toBeTypeOf("string");
    expect(defaultSessionIdGenerator().length).toBeGreaterThan(0);
  });

  it("SS2: session IDs are unique", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => defaultSessionIdGenerator())
    );

    expect(ids).toHaveLength(100);
  });

  it("SS3: session ID is visible ASCII", () => {
    const id = defaultSessionIdGenerator();

    for (const character of id) {
      const codePoint = character.charCodeAt(0);

      expect(codePoint).toBeGreaterThanOrEqual(0x21);
      expect(codePoint).toBeLessThanOrEqual(0x7e);
    }
  });

  it("SS4: create(id) stores session, has(id) returns true", () => {
    const store = createSessionStore();
    const session = store.create("session-1");

    expect(session.id).toBe("session-1");
    expect(store.has("session-1")).toBe(true);
  });

  it("SS5: get(id) returns session with id, initialized, createdAt", () => {
    const store = createSessionStore();

    store.create("session-1");

    expect(store.get("session-1")).toEqual({
      id: "session-1",
      initialized: false,
      createdAt: expect.any(Date),
    });
  });

  it("SS6: get(unknownId) returns undefined", () => {
    const store = createSessionStore();

    expect(store.get("unknown-session")).toBeUndefined();
  });

  it("SS7: delete(id) removes session", () => {
    const store = createSessionStore();

    store.create("session-1");

    expect(store.delete("session-1")).toBe(true);
    expect(store.has("session-1")).toBe(false);
    expect(store.get("session-1")).toBeUndefined();
  });

  it("SS8: delete(unknownId) returns false", () => {
    const store = createSessionStore();

    expect(store.delete("unknown-session")).toBe(false);
  });

  it("SS9: has(unknownId) returns false", () => {
    const store = createSessionStore();

    expect(store.has("unknown-session")).toBe(false);
  });
});
