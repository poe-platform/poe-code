import { test } from "node:test";
import assert from "node:assert/strict";
import ownSkills from "../dist/plugin-skills.js";
import referenceSkills from "../../poe-agent/dist/plugins/poe-agent-plugin-skills.js";
import ownScratch from "../dist/plugin-scratchpad.js";
import referenceScratch from "../../poe-agent/dist/plugins/poe-agent-plugin-scratchpad.js";
import ownSpawn from "../dist/plugin-spawn.js";
import referenceSpawn from "../../poe-agent/dist/plugins/poe-agent-plugin-spawn.js";
import * as ownArgs from "../dist/plugin-args.js";
import * as referenceArgs from "../../poe-agent/dist/plugins/plugin-args.js";
import * as ownParse from "../dist/parse-options.js";
import * as referenceParse from "../../poe-agent/dist/plugins/parse-options.js";

test("skill guidance matches seeded names, normalization, opaque metadata and late active-tool values", () => {
  let seed = 0x5eed2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const names = [" repo ", "\uFEFFgit\uFEFF", "", "🌍\ud800", "repo", "empty"];
  for (let sample = 0; sample < 64; sample++) {
    const definitions = Object.fromEntries(
      names.map((name) => [
        name,
        random() % 2
          ? ["read", " read ", "", "🌍"]
          : { tools: ["git", " git "], tags: ["code", " code "] }
      ])
    );
    const options = {
      definitions,
      skills: () => [names[random() % names.length], "repo", " repo ", "missing"],
      toolRegistry: {
        getActiveTools() {
          return [{ name: "echo" }, { name: "🌍" }];
        }
      }
    };
    const active = options.skills();
    options.skills = () => active;
    const metadata = { opaque: { sample } },
      context = { userPrompt: "request", system: "base", metadata };
    assert.deepEqual(ownSkills(options).prompt(context), referenceSkills(options).prompt(context));
  }
});

test("skill callbacks and getters preserve read order, and absent definitions avoid unused stringification", () => {
  for (const active of [[], ["repo"]]) {
    const results = [];
    for (const create of [referenceSkills, ownSkills]) {
      const reads = [];
      const options = {
        definitions: { repo: { tools: ["read"], tags: ["code"] } },
        get skills() {
          reads.push("skills");
          return function () {
            reads.push(this === options ? "options" : "other");
            return active;
          };
        },
        get toolRegistry() {
          reads.push("registry");
          return {
            getActiveTools(value) {
              reads.push(value);
              return [
                {
                  get name() {
                    reads.push("name");
                    return {
                      toString() {
                        reads.push("toString");
                        return "echo";
                      }
                    };
                  }
                }
              ];
            }
          };
        }
      };
      const value = create(options).prompt({
        userPrompt: "request",
        system: "base",
        metadata: { opaque: true }
      });
      results.push({ reads, system: value.system, active: value.metadata.skills.active });
    }
    assert.deepEqual(results[1], results[0]);
  }
  for (const cause of [null, false, 0, "", { failed: true }]) {
    for (const create of [referenceSkills, ownSkills]) {
      const plugin = create({
        definitions: { repo: [] },
        skills: ["repo"],
        toolRegistry: {
          getActiveTools() {
            return [
              {
                name: {
                  toString() {
                    throw cause;
                  }
                }
              }
            ];
          }
        }
      });
      assert.throws(
        () => plugin.prompt({ userPrompt: "request" }),
        (error) => error === cause
      );
    }
  }
});

test("scratchpad keys and overwritten values preserve lone-surrogate strings", () => {
  const results = [];
  for (const create of [referenceScratch, ownScratch]) {
    const plugin = create(),
      write = plugin.tools.find((tool) => tool.name === "write_note"),
      read = plugin.tools.find((tool) => tool.name === "read_note");
    const output = [];
    output.push(read.call({ key: "\ud800" }));
    output.push(write.call({ key: "\ud800", value: "first" }));
    output.push(write.call({ key: "\ud800", value: "🌍\udfff" }));
    output.push(read.call({ key: "\ud800" }));
    results.push(output);
    assert.equal(
      create()
        .tools.find((tool) => tool.name === "read_note")
        .call({ key: "\ud800" }),
      "(no note)"
    );
  }
  assert.deepEqual(results[1], results[0]);
});

test("shared scalar arguments and options match rejection labels and numeric/string boundaries", () => {
  for (const value of [
    undefined,
    null,
    false,
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    -1,
    0.5,
    1,
    Number.MAX_VALUE,
    "",
    " \uFEFF",
    "🌍\ud800",
    {},
    []
  ]) {
    for (const name of [
      "getRequiredString",
      "getOptionalString",
      "getOptionalBoolean",
      "getOptionalNumber",
      "getOptionalNonNegativeInteger"
    ]) {
      const results = [];
      for (const api of [referenceArgs, ownArgs]) {
        try {
          results.push({ value: api[name]({ "key\ud800": value }, "key\ud800") });
        } catch (error) {
          results.push({ name: error.name, message: error.message });
        }
      }
      assert.deepEqual(results[1], results[0], name);
    }
    for (const name of [
      "readOptionalString",
      "readOptionalStringArray",
      "readOptionalNonNegativeInteger"
    ]) {
      const results = [];
      for (const api of [referenceParse, ownParse]) {
        try {
          results.push({ value: api[name]({ key: value }, "key") });
        } catch (error) {
          results.push({ name: error.name, message: error.message });
        }
      }
      assert.deepEqual(results[1], results[0], name);
    }
  }
  for (const api of [referenceArgs, ownArgs]) {
    assert.equal(api.getRequiredString({ key: " " }, "key", true), " ");
    let reads = 0;
    assert.equal(
      api.getOptionalNumber(
        {
          get key() {
            reads++;
            return 1;
          }
        },
        "key"
      ),
      1
    );
    assert.equal(reads, 1);
    const cause = { failed: true };
    assert.throws(
      () =>
        api.getRequiredString(
          {
            get key() {
              throw cause;
            }
          },
          "key"
        ),
      (error) => error === cause
    );
  }
});

test("spawn tool retains injected callback results and original rejection causes", async () => {
  for (const create of [referenceSpawn, ownSpawn]) {
    const tool = create().tools[0],
      opaque = { owned: true };
    let seen;
    assert.equal(
      await tool.call(
        { task: " request " },
        {
          async spawn(task) {
            seen = task;
            return { output: opaque };
          }
        }
      ),
      opaque
    );
    assert.equal(seen, " request ");
    for (const cause of [null, false, 0, "", { failed: true }])
      await assert.rejects(
        tool.call(
          { task: "request" },
          {
            spawn() {
              throw cause;
            }
          }
        ),
        (error) => error === cause
      );
  }
});
