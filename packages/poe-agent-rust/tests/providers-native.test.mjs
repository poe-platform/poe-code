import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as original from "../../poe-agent/dist/index.js";
test("provider callbacks can extend the provider list during ordered resolution", () => {
  for (const implementation of [original, own]) {
    const later = {
        name: "later",
        supports: () => true,
        createModel: () => {
          throw Error("not called");
        }
      },
      providers = [];
    providers.push({
      name: "first",
      supports() {
        providers.push(later);
        return false;
      },
      createModel() {
        throw Error("not called");
      }
    });
    assert.equal(implementation.resolveProvider(providers, "model"), later);
  }
});
test("provider callbacks preserve this, unicode errors, opaque options and falsy causes", async () => {
  for (const [implementation, metadata] of [
    [original, await import("../../poe-agent/dist/runtime/provider-metadata.js")],
    [own, await import("../dist/provider-metadata.js")]
  ]) {
    const payload = {};
    payload.self = payload;
    const provider = {
        name: "p\ud800",
        supports(model) {
          return this.name === model;
        },
        createModel() {
          throw Error("not called");
        }
      },
      plugin = { name: "plugin\udc00", providers: [provider] };
    metadata.setResolvedPluginOptions(plugin, payload);
    assert.equal(implementation.collectProviders([plugin])[0], provider);
    assert.equal(metadata.getResolvedProviderOptions(provider), payload);
    assert.equal(implementation.resolveProvider([provider], provider.name), provider);
    for (const cause of [undefined, null, false, 0, "", 0n]) {
      let thrown;
      try {
        implementation.resolveProvider(
          [
            {
              name: "p\ud800",
              supports() {
                throw cause;
              }
            }
          ],
          "m\udc00"
        );
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof implementation.ProviderResolutionError);
      assert.ok(Object.is(thrown.cause, cause));
      assert.equal(thrown.providerName, "p\ud800");
      assert.ok(thrown.message.includes("m\udc00"));
    }
  }
});
