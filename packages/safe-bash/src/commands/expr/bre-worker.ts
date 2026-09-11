import { isMainThread } from "node:worker_threads";
import { matchExprSteps, searchBreSteps } from "./bre-engine.js";
import type { BreSearchDescriptor, BreSearchResult, ExprMatchDescriptor, ExprMatchResult } from "../regex-execution/protocol.js";

export function matchExpr(descriptor: ExprMatchDescriptor, subject: Uint8Array): ExprMatchResult {
  if (isMainThread) throw new Error("expr BRE compilation/execution requires the regex worker");
  const execution = matchExprSteps(descriptor, subject);
  let step = execution.next();
  while (!step.done) step = execution.next();
  return step.value;
}

export function searchBre(descriptor: BreSearchDescriptor, subject: Uint8Array): BreSearchResult {
  if (isMainThread) throw new Error("BRE compilation/execution requires the regex worker");
  const execution = searchBreSteps(descriptor, subject);
  let step = execution.next();
  while (!step.done) step = execution.next();
  return step.value;
}
