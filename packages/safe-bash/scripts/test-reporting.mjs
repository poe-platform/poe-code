import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { compose } from "node:stream";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

export function reporterArguments(args) {
  if (args.some(argument => argument === "--test-reporter" || argument.startsWith("--test-reporter=") || argument === "--test-reporter-destination" || argument.startsWith("--test-reporter-destination="))) return [];
  return [`--test-reporter=${import.meta.url}`];
}

export function runNodeTests(args, spawn = spawnSync) {
  const result = spawn(process.execPath, ["--test", ...reporterArguments(args), ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export default async function* conciseReporter(events) {
  async function* failuresAndSummaries() {
    const files = new Map();
    let completed = 0;
    for await (const event of events) {
      const { type, data } = event;
      const file = data.file ? resolve(data.file) : undefined;
      if (file && !files.has(file)) files.set(file, { output: [], names: [], failed: false });
      const state = files.get(file);
      if (type === "test:start") {
        if (state) {
          state.names.length = data.nesting;
          state.names.push(data.name);
        }
      } else if (type === "test:pass") {
        if (state) state.names.length = data.nesting;
      } else if (type === "test:stdout" || type === "test:stderr" || type === "test:diagnostic") {
        if (!state || state.failed) yield event;
        else state.output.push(event);
      } else if (type === "test:fail") {
        if (state) {
          yield* state.output;
          state.output = [];
          state.failed = true;
          const name = [...state.names.slice(0, data.nesting), data.name].join(" > ");
          state.names.length = data.nesting;
          yield { ...event, data: { ...data, name } };
        } else yield event;
      } else if (type === "test:summary" && file) {
        if (!data.success) yield* state.output;
        files.delete(file);
        completed++;
        if (completed % 100 === 0) {
          yield { type: "test:diagnostic", data: { nesting: 0, message: `completed ${completed} test files` } };
        }
      } else {
        yield event;
      }
    }
    for (const state of files.values()) yield* state.output;
  }
  yield* compose(failuresAndSummaries(), new spec());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runNodeTests(process.argv.slice(2));
}
