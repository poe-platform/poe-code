import { test, expect } from "vitest";
import { LazyInput } from "./index.js";

test("bulk decoding admits retained chunks before advancing the source", async () => {
  const failure = new Error("retained byte budget exceeded");
  let advanced = false, closed = false, decoded = false;
  const file = new LazyInput("data.csv", () => (async function* () {
    try {
      yield Uint8Array.of(97, 10);
      advanced = true;
      yield Uint8Array.of(98, 10);
    } finally { closed = true; }
  })(), {
    names: ["custom"],
    async encode(text) { return new TextEncoder().encode(text); },
    async decode() { decoded = true; return "a\nb\n"; }
  }, "custom", new AbortController().signal, () => { throw failure; }, () => {});
  try {
    await expect(file.read()).rejects.toBe(failure);
    expect(advanced).toBe(false);
    expect(closed).toBe(true);
    expect(decoded).toBe(false);
  } finally { await file.close(); }
});

test("bulk decoding owns reused chunks and admits the joined allocation", async () => {
  const admissions: number[] = [];
  const buffer = Uint8Array.of(97, 10);
  const file = new LazyInput("data.csv", () => (async function* () {
    yield buffer;
    buffer[0] = 98;
    yield buffer;
    buffer.fill(0);
  })(), {
    names: ["custom"],
    async encode(text) { return new TextEncoder().encode(text); },
    async decode(bytes) { return new TextDecoder().decode(bytes); }
  }, "custom", new AbortController().signal, size => { admissions.push(size); }, () => {});
  try {
    expect(await file.read()).toBe("a\nb\n");
    expect(admissions).toEqual([2, 2, 4, 8]);
  } finally { await file.close(); }
});

test("bulk decoding observes cancellation before copying or decoding a supplied chunk", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel bulk input");
  let retained = false, decoded = false, closed = false;
  const file = new LazyInput("data.csv", () => (async function* () {
    try {
      controller.abort(reason);
      yield Uint8Array.of(97);
    } finally { closed = true; }
  })(), {
    names: ["custom"],
    async encode(text) { return new TextEncoder().encode(text); },
    async decode() { decoded = true; return "a"; }
  }, "custom", controller.signal, () => { retained = true; }, () => {});
  try {
    await expect(file.read()).rejects.toBe(reason);
    expect(retained).toBe(false);
    expect(decoded).toBe(false);
    expect(closed).toBe(true);
  } finally { await file.close(); }
});
