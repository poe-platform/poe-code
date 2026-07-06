import { afterEach, describe, expect, it } from "vitest";
import { fakeService } from "./fakes.js";
import { createHarnessFixtureGroup, type FixtureService } from "./fixtures.js";
import { createCommandTestHarness } from "./harness.js";

const originalSecret = process.env.FIXTURE_REQUIRED_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.FIXTURE_REQUIRED_SECRET;
  } else {
    process.env.FIXTURE_REQUIRED_SECRET = originalSecret;
  }
});

function createHarness() {
  return createCommandTestHarness(createHarnessFixtureGroup(), {
    services: {
      fakeService: fakeService<FixtureService>({ execute: async (value) => value })
    }
  });
}

describe("createCommandTestHarness hermetic behavior", () => {
  it("never reads matching values from process.env", async () => {
    process.env.FIXTURE_REQUIRED_SECRET = "poison";

    const result = await createHarness().run(["secrets"]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("secrets");
  });

  it("serializes identical runs identically", async () => {
    const first = await createHarness().run(["params"], { name: "Ada" });
    const second = await createHarness().run(["params"], { name: "Ada" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps async pending results deterministic and timestamp-free", async () => {
    const first = await createHarness().run(["async-human-in-loop"], { target: "prod" });
    const second = await createHarness().run(["async-human-in-loop"], { target: "prod" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.value).toHaveProperty("enqueuedAt", "");
  });
});
