import { expect, it } from "vitest";
import { createGuestReference, revokeGuestReference } from "./host-capabilities.js";
import { cloneSandboxValue } from "./values.js";

it.each([false, true])("rejects capability structured cloning without activating it (revoked: %s)", revoked => {
  let activations = 0;
  const owner = {};
  const reference = createGuestReference([{ secret: "host-only" }], owner, () => { activations++; });
  if (revoked) revokeGuestReference(reference, owner);
  for (const input of [reference, { reference }]) {
    expect(() => cloneSandboxValue(input, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  }
  expect(() => cloneSandboxValue(reference)).toThrow(TypeError);
  expect(activations).toBe(0);
});
