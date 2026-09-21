import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Volume, createFsFromVolume } from "memfs";
import ownCompaction from "../dist/plugin-compaction.js";
import referenceCompaction from "../../poe-agent/dist/plugins/poe-agent-plugin-compaction.js";
import ownMemory from "../dist/plugin-memory.js";
import referenceMemory from "../../poe-agent/dist/plugins/poe-agent-plugin-memory.js";
import ownAudit from "../dist/plugin-audit-log.js";
import referenceAudit from "../../poe-agent/dist/plugins/poe-agent-plugin-audit-log.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");

test("seeded compaction keeps systems and recent turns, drops old summaries and preserves opaque entry identity", async () => {
  let seed = 0x5eed2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  for (let sample = 0; sample < 64; sample++) {
    const source = Array.from({ length: 32 }, (_, n) => ({
      role: ["user", "assistant", "system", "tool"][random() % 4],
      content: "x".repeat(64) + n,
      ...(random() % 2 ? { name: "compaction" } : {}),
      opaque: { sample, n }
    }));
    const limit = [0, 1, 2, 3, -1, 0.5, NaN, Infinity][sample % 8],
      results = [];
    for (const create of [referenceCompaction, ownCompaction]) {
      const messages = [...source],
        calls = [];
      const context = {
        messages,
        readFiles: new Set(["z", "a"]),
        modifiedFiles: new Set(["b"]),
        signal: new AbortController().signal,
        async complete(request) {
          calls.push(request);
          return " summary 🌍\ud800 ";
        },
        async runHook(event, hook) {
          calls.push(event);
          if (event === "postCompaction") hook.summary = "changed 🌍\ud800";
          return { type: "continue" };
        }
      };
      await create({ threshold: 0, keepLastTurns: limit }).hooks.postIteration(context);
      const preserved = messages.filter((message) => source.includes(message));
      for (const message of preserved) assert.ok(source.includes(message));
      results.push({ messages, calls });
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test("compaction only reads preserved-prefix names and coerces the turn limit after finding a user", () => {
  const reads = [];
  let names = 0;
  const messages = [
    {
      get role() {
        reads.push("system");
        return "system";
      },
      get name() {
        names++;
        return "original";
      },
      content: "keep"
    },
    { role: "assistant", content: "drop" },
    {
      get role() {
        reads.push("user");
        return "user";
      },
      get name() {
        throw Error("Tail names must not be read");
      },
      content: "tail"
    }
  ];
  const keep = {
    valueOf() {
      reads.push("valueOf");
      return 1;
    }
  };
  const result = native.planAgentCompaction(messages, keep);
  assert.equal(result.messages[0], messages[0]);
  assert.equal(result.messages[1], messages[2]);
  assert.equal(result.droppedMessages[0], messages[1]);
  assert.deepEqual(reads, ["user", "valueOf", "system"]);
  assert.equal(names, 1);
  const ignored = {
    valueOf() {
      throw Error("No user means no numeric coercion");
    }
  };
  assert.equal(native.planAgentCompaction([{ role: "system", content: "keep" }], ignored), null);
});

test("recursive memory imports handle Unicode, CRLF, repeated branches and cached failures", async () => {
  for (const fail of [false, true]) {
    const results = [];
    for (const create of [referenceMemory, ownMemory]) {
      const volume = Volume.fromJSON(
        {
          "/project/AGENTS.md": "Project\r\n\uFEFF@ ./guide.md\uFEFF\r\n@handle\r\n@ ./guide.md",
          "/project/guide.md": fail ? "@ ./AGENTS.md" : "Guide 🌍\ud800",
          "/home/.config/poe-code/AGENTS.md": "User memory"
        },
        "/"
      );
      const fs = createFsFromVolume(volume).promises;
      let reads = 0;
      const read = fs.readFile.bind(fs);
      fs.readFile = (...args) => {
        reads++;
        return read(...args);
      };
      const plugin = create({ cwd: "/project", homeDir: "/home", fs }),
        context = { userPrompt: "request", system: "base", opaque: { owned: true } };
      if (fail) {
        let first;
        await assert.rejects(plugin.prompt(context), (error) => {
          first = error;
          return error.message.includes("Circular");
        });
        await assert.rejects(plugin.prompt(context), (error) => error === first);
        results.push({ reads, message: first.message });
      } else {
        const first = await plugin.prompt(context),
          second = await plugin.prompt(context);
        assert.deepEqual(first, second);
        assert.equal(first.opaque, context.opaque);
        results.push({ reads, first });
      }
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test("memory import scanner covers all Unicode whitespace and does not normalize lone surrogates", () => {
  const whitespace = [
    9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
    8202, 8232, 8233, 8239, 8287, 12288, 65279
  ];
  for (const code of whitespace) {
    const space = String.fromCharCode(code);
    assert.equal(native.agentMemoryImport(space + "@ ./guide.md" + space), "./guide.md");
    assert.equal(native.agentMemoryImport("@ ./a" + space + "b.md"), null);
  }
  assert.equal(native.agentMemoryImport("@ ./🌍\ud800.md"), "./🌍\ud800.md");
  assert.deepEqual(native.agentMemoryLines("\ud800\r\n\udfff\r\n"), ["\ud800", "\udfff", ""]);
});

test("audit records preserve opaque fields and callback read order while tool append failures remain optional", async () => {
  const results = [];
  for (const create of [referenceAudit, ownAudit]) {
    const reads = [],
      lines = [];
    const fs = {
      async lstat() {
        return {
          isSymbolicLink() {
            return false;
          }
        };
      },
      async appendFile(path, line) {
        lines.push(JSON.parse(line));
      }
    };
    const plugin = create("/audit", fs),
      summary = {
        toJSON() {
          reads.push("summary.toJSON");
          return "owned";
        }
      };
    await plugin.hooks.postToolUse({
      get tool() {
        reads.push("tool");
        return "echo";
      }
    });
    await plugin.hooks.postCompaction({
      get summary() {
        reads.push("summary");
        return summary;
      },
      get droppedMessages() {
        reads.push("dropped");
        return {
          get length() {
            reads.push("length");
            return 2;
          }
        };
      }
    });
    results.push({ reads, lines: lines.map(({ ts, ...rest }) => rest) });
    const cause = { failed: true },
      bad = create("/audit", {
        ...fs,
        async appendFile() {
          throw cause;
        }
      });
    await bad.hooks.postToolUse({ tool: "echo" });
    await assert.rejects(
      bad.hooks.postCompaction({ summary: "owned", droppedMessages: [] }),
      (error) => error === cause
    );
  }
  assert.deepEqual(results[1], results[0]);
});
