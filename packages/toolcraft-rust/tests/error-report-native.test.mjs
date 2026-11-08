import assert from "node:assert/strict";
import { test } from "node:test";
import { CommanderError } from "commander";
import * as native from "../dist/error-report.js";
import * as reference from "../../toolcraft/dist/error-report.js";
import { UserError as NativeUserError } from "../dist/index.js";
import { UserError as ReferenceUserError } from "../../toolcraft/dist/index.js";
import { ApprovalDeclinedError as NativeDeclined } from "../dist/approval-error.js";
import { ApprovalDeclinedError as ReferenceDeclined } from "../../toolcraft/dist/human-in-loop/types.js";

test("report admission preserves enablement, routine error classes and short-circuit reads", async () => {
  for (const [lib, UserError, Declined] of [[native, NativeUserError, NativeDeclined], [reference, ReferenceUserError, ReferenceDeclined]]) {
    const marker = new Error("report path reached");
    for (const error of [new UserError("routine"), new Declined({ commandPath: "run" }),
      new CommanderError(0, "commander.helpDisplayed", "help"), new CommanderError(0, "commander.version", "version")]) {
      assert.equal(await lib.writeErrorReport({ env: {}, errorReports: true, error, get projectRoot() { throw marker; } }), undefined);
    }
    for (const error of [new Error("reportable"), new UserError("has cause", { cause: false }), { name: "ApprovalDeclinedError" },
      new CommanderError(1, "commander.invalidArgument", "invalid")]) {
      await assert.rejects(lib.writeErrorReport({ env: {}, errorReports: true, error, get projectRoot() { throw marker; } }), value => value === marker);
    }
    for (const errorReports of [false, undefined]) {
      assert.equal(await lib.writeErrorReport({ env: {}, errorReports, get error() { throw marker; } }), undefined);
      await assert.rejects(lib.writeErrorReport({ env: { TOOLCRAFT_ERROR_REPORTS: "1" }, errorReports, get error() { throw marker; } }), value => value === marker);
    }
  }
});

test("approval error adapters preserve declared fields and constructor getter order", () => {
  const run = Declined => {
    const reads = [];
    const options = new Proxy({ commandPath: "run", reason: "because", approvalId: "id" }, { get(target, key, receiver) { reads.push(key); return Reflect.get(target, key, receiver); } });
    const error = new Declined(options);
    return { keys: Object.keys(error), name: error.name, message: error.message, reason: error.reason, approvalId: error.approvalId, commandPath: error.commandPath, reads };
  };
  assert.deepEqual(run(NativeDeclined), run(ReferenceDeclined));
});
