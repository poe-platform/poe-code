import { test } from "node:test";
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import * as native from "../dist/index.js";

const reference = await tsImport("../../toolcraft/src/index.ts", import.meta.url);
async function outcome(implementation, command, options) {
  try {
    await implementation.assertCommandRequirements(command, {}, options);
    return undefined;
  } catch (error) {
    return { name: error.name, message: error.message };
  }
}

test("requirements preserve authentication/version errors and numeric edge cases", async () => {
  const requirements = [
    undefined,
    {},
    { auth: true },
    ...[
      "1.0.0",
      ">=1.0.0",
      ">=2.4.0",
      ">=\ufeff001.0.0\u00a0",
      ">=9007199254740993.0.0",
      ">=" + "9".repeat(400) + ".0.0",
      ">=\ud800.0.0",
      ">=1.0.0-beta"
    ].map((apiVersion) => ({ apiVersion }))
  ];
  for (const requires of requirements)
    for (const apiVersion of [
      undefined,
      "0.9.9",
      "1.0.0",
      "2.4.0",
      "9007199254740992.0.0",
      " 1.0.0",
      "bad\ud800"
    ]) {
      const command = { name: "deploy\ud800", requires };
      const options = { apiVersion, env: {} };
      assert.deepEqual(
        await outcome(native, command, options),
        await outcome(reference, command, options)
      );
    }
});

test("requirements retain callback receiver, context, rejection and read order", async () => {
  for (const implementation of [native, reference]) {
    const context = { arbitrary: 1n },
      failure = new Error("callback failure");
    const requires = {
      check(value) {
        assert.equal(this, requires);
        assert.equal(value, context);
        throw failure;
      }
    };
    await assert.rejects(
      implementation.assertCommandRequirements({ name: "x", requires }, context),
      (error) => error === failure
    );
    for (const message of [undefined, "", "repair\ud800"]) {
      await assert.rejects(
        implementation.assertCommandRequirements(
          { name: "x", requires: { check: () => ({ ok: false, message }) } },
          context
        ),
        (error) => error.message === (message ?? "Command precondition failed.")
      );
    }
  }
  const reads = async (implementation) => {
    const events = [];
    const requires = {
      get apiVersion() {
        events.push("required");
        return ">=2.0.0";
      }
    };
    const options = {
      get env() {
        events.push("env");
        return {};
      },
      get authEnvVar() {
        events.push("authEnvVar");
        return undefined;
      },
      get apiVersion() {
        events.push("runner");
        return "1.0.0";
      }
    };
    await outcome(implementation, { name: "x", requires }, options);
    return events;
  };
  assert.deepEqual(await reads(native), await reads(reference));
});

test("secret resolution preserves descriptors, inherited environment values and suggestions", () => {
  const commands = [
    { secrets: { token: { env: "TOKEN" } } },
    { secrets: { token: { env: "POE_API_KEY", description: "Set the key." } } },
    { secrets: { token: { env: "MISSING", optional: true } } },
    {
      secrets: JSON.parse(
        '{"__proto__":{"env":"TOKEN"},"constructor":{"env":"OPTIONAL","optional":true}}'
      )
    }
  ];
  for (const command of commands)
    for (const env of [
      {},
      { TOKEN: "" },
      { TOKNE: "value" },
      { POE_KEY: "value", POE_APIKEY: "value" },
      Object.create({ TOKEN: "inherited" })
    ]) {
      const resolve = (implementation) => {
        try {
          return {
            descriptors: Object.getOwnPropertyDescriptors(
              implementation.resolveCommandSecrets(command, env)
            )
          };
        } catch (error) {
          return { name: error.name, message: error.message };
        }
      };
      assert.deepEqual(resolve(native), resolve(reference));
    }
});
