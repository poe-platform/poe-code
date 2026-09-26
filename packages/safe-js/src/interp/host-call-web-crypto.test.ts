import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => { throw new Error("Node crypto is unavailable in this host"); });

afterEach(() => vi.unstubAllGlobals());

it("initializes the journal and preserves argument digests without Node crypto", async () => {
  const { digestHostCallArguments, HostCallJournal } = await import("./host-call.js");
  const randomUUID = vi.fn(() => "123e4567-e89b-42d3-a456-426614174000");
  vi.stubGlobal("crypto", { randomUUID });
  new HostCallJournal("source");
  expect(randomUUID).toHaveBeenCalledTimes(1);
  expect(digestHostCallArguments([])).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
});
