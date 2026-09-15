import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UnicodeEscapeDecoder} from "./unicode-escape.js";

it.each([false, true])("bounds retained empty escape snapshots (raw=%s)", raw => {
  const decoder = new UnicodeEscapeDecoder(raw, "strict", () => {throw Error("unexpected warning");});
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const snapshots = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) snapshots.push(decoder.getstate(meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.length).toBeLessThan(100);
  let retry: unknown;
  try {decoder.getstate(meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([false, true])("bounds repeated empty escape decode storage (raw=%s)", raw => {
  const decoder = new UnicodeEscapeDecoder(raw, "strict", () => {throw Error("unexpected warning");});
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const input = new Uint8Array(), output = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) output.push(decoder.decode(input, false, meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(100);
  for (const text of output) expect(text.length).toBe(0);
  let retry: unknown;
  try {decoder.decode(input, true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([false, true].flatMap(raw => ["decode", "setstate", "reset"].map(operation => ({raw, operation}))))(
  "denies escape $operation allocation before mutation (raw=$raw)", ({raw, operation}) => {
    const decoder = new UnicodeEscapeDecoder(raw, "strict", () => {throw Error("unexpected warning");});
    if (operation !== "decode") decoder.decode(new Uint8Array([92, 117]));
    const before = decoder.getstate();
    const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
    const mutate = () => operation === "reset" ? decoder.reset(meter)
      : operation === "setstate" ? decoder.setstate([new Uint8Array(), 0n], meter)
      : decoder.decode(new Uint8Array(), false, meter);
    let failure: unknown;
    try {mutate();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(decoder.getstate()).toEqual(before);
    let retry: unknown;
    try {mutate();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(decoder.getstate()).toEqual(before);
});
