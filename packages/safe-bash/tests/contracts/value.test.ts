import assert from "node:assert/strict";
import { test } from "node:test";
import { concatShellValues, shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueRetainedBytes, shellValueText } from "../../src/contracts/value.js";
import type { ValueAllocation } from "../../src/contracts/value.js";

const ResizableArrayBuffer = ArrayBuffer as unknown as new (length: number, options: { maxByteLength: number }) => ArrayBuffer & { resize(length: number): void };

test("byte values copy input and never expose their authoritative buffer", () => {
  const input = Uint8Array.of(255, 0, 65);
  const value = shellValueFromBytes(input);
  input.fill(0);
  const first = shellValueBytes(value);
  first.fill(1);
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(255, 0, 65));
  assert.equal(shellValueByteLength(value), 3);
  assert.equal(Object.isFrozen(value), true);
});

test("raw invalid UTF8 and genuine replacement text have distinct encodings", () => {
  const value = shellValueFromBytes(Uint8Array.of(255));
  assert.equal(shellValueText(value), "\ufffd");
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(255));
  assert.deepEqual(shellValueBytes("\ufffd"), Uint8Array.of(239, 191, 189));
});

test("text values preserve lone surrogates until UTF8 serialization", () => {
  assert.equal(shellValueText("\ud800"), "\ud800");
  assert.deepEqual(shellValueBytes("\ud800"), Uint8Array.of(239, 191, 189));
  assert.equal(concatShellValues(["\ud83d", "\ude42"]), "🙂");
});

test("mixed concatenation coalesces adjacent genuine text before encoding", () => {
  const value = concatShellValues([shellValueFromBytes(Uint8Array.of(255)), "\ud83d", "\ude42"]);
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(255, 240, 159, 153, 130));
});

test("mixed bytes derive one projection after concatenation", () => {
  const value = concatShellValues([shellValueFromBytes(Uint8Array.of(195)), shellValueFromBytes(Uint8Array.of(169))]);
  assert.equal(shellValueText(value), "é");
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(195, 169));
});

test("byte projection retains a UTF8 byte-order mark", () => {
  assert.equal(shellValueText(shellValueFromBytes(Uint8Array.of(239, 187, 191, 65))), "\ufeffA");
});

test("empty and one-value concatenations preserve immutable identities", () => {
  const value = shellValueFromBytes(Uint8Array.of(255));
  assert.equal(concatShellValues([]), "");
  assert.equal(concatShellValues([value]), value);
});

test("allocation admission precedes byte copying and projection", () => {
  const reason = Object.freeze({ denied: true });
  const buffer = new ArrayBuffer(1);
  const input = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  assert.throws(() => shellValueFromBytes(input), TypeError);
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() { throw reason; },
  };
  assert.throws(() => shellValueFromBytes(input, allocation), (error) => error === reason);
});

test("successful allocation commits the exact immutable value", () => {
  const events: unknown[] = [];
  const allocation: ValueAllocation = {
    assertOpen() { events.push("open"); },
    reserve(bytes, slots) {
      events.push([bytes, slots]);
      return { commit(value) { events.push(value); }, release() { events.push("release"); } };
    },
  };
  const value = shellValueFromBytes(Uint8Array.of(255), allocation);
  assert.deepEqual(events, ["open", [67, 1], value]);
});

test("commit failure releases reservation and preserves thrown identity", () => {
  const reason = Object.freeze({ failed: true });
  let released = 0;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() { return { commit() { throw reason; }, release() { released++; } }; },
  };
  assert.throws(() => shellValueFromBytes(Uint8Array.of(255), allocation), (error) => error === reason);
  assert.equal(released, 1);
});

test("public byte materialization reserves its distinct owned copy", () => {
  const value = shellValueFromBytes(Uint8Array.of(255));
  let committed: object | undefined;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve(bytes, slots) {
      assert.equal(bytes, 65);
      assert.equal(slots, 1);
      return { commit(copy) { committed = copy; }, release() {} };
    },
  };
  const copy = shellValueBytes(value, allocation);
  assert.equal(committed, copy);
  assert.notEqual(copy, value);
});

test("forged carriers and closed allocation scopes are refused", () => {
  assert.throws(() => shellValueText({} as ReturnType<typeof shellValueFromBytes>), TypeError);
  const reason = new Error("closed");
  const allocation: ValueAllocation = { assertOpen() { throw reason; }, reserve() { throw new Error("unreachable"); } };
  assert.throws(() => shellValueFromBytes(Uint8Array.of(255), allocation), (error) => error === reason);
});

test("mixed concatenation encodes every adjacent text boundary like one JS string", () => {
  for (const parts of [["\ud800", "", "\udc00"], ["\ud800", "A", "\udc00"], ["é", "🙂", "\ud800"], ["\udc00", "\ud800", "B"]]) {
    const value = concatShellValues([shellValueFromBytes(Uint8Array.of(255)), ...parts]);
    assert.deepEqual(shellValueBytes(value), Uint8Array.of(255, ...new TextEncoder().encode(parts.join(""))));
  }
});

test("a byte segment separates genuine text surrogate halves", () => {
  const value = concatShellValues(["\ud83d", shellValueFromBytes(Uint8Array.of(65)), "\ude42"]);
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(239, 191, 189, 65, 239, 191, 189));
});

test("allocation cleanup retains both falsey primary and cleanup failure", () => {
  const cleanup = new Error("release failed");
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() { return { commit() { throw undefined; }, release() { throw cleanup; } }; },
  };
  assert.throws(() => shellValueFromBytes(Uint8Array.of(255), allocation), error => error instanceof AggregateError && error.errors.length === 2 && error.errors[0] === undefined && error.errors[1] === cleanup);
});

test("intrinsic view bounds defeat shadowed length, offset and buffer properties", () => {
  const backing = new Uint8Array(68).fill(255);
  const input = backing.subarray(2, 66);
  Object.defineProperties(input, { byteLength: { value: 0 }, byteOffset: { value: 0 }, buffer: { value: new ArrayBuffer(0) } });
  let reserved = 0;
  const value = shellValueFromBytes(input, { assertOpen() {}, reserve(bytes) { reserved = bytes; return { commit() {}, release() {} }; } });
  assert.equal(shellValueByteLength(value), 64);
  assert.equal(reserved, 256);
  assert.ok(shellValueRetainedBytes(value) <= reserved);
  assert.deepEqual(shellValueBytes(value), new Uint8Array(64).fill(255));
});

test("resizing during reservation cannot expand the admitted input extent", () => {
  const buffer = new ResizableArrayBuffer(1, { maxByteLength: 64 });
  const input = new Uint8Array(buffer);
  input[0] = 255;
  let reserved = 0;
  const value = shellValueFromBytes(input, { assertOpen() {}, reserve(bytes) { reserved = bytes; buffer.resize(64); return { commit() {}, release() {} }; } });
  assert.equal(reserved, 67);
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(255));
  assert.ok(shellValueRetainedBytes(value) <= reserved);
});

test("shrinking or detaching after admission releases once without committing", () => {
  for (const detach of [false, true]) {
    const buffer = new ResizableArrayBuffer(8, { maxByteLength: 16 });
    const input = new Uint8Array(buffer, 2, 4);
    let releases = 0;
    let commits = 0;
    assert.throws(() => shellValueFromBytes(input, {
      assertOpen() {},
      reserve() {
        if (detach) structuredClone(buffer, { transfer: [buffer] });
        else buffer.resize(1);
        return { commit() { commits++; }, release() { releases++; } };
      },
    }), TypeError);
    assert.equal(releases, 1);
    assert.equal(commits, 0);
  }
});

for (const replacement of ["BCDE", "B", shellValueFromBytes(Uint8Array.of(254))]) {
  test(`concat captures post-metadata-admission values: ${typeof replacement === "string" ? replacement : "raw"}`, () => {
    const parts = [shellValueFromBytes(Uint8Array.of(255)), "A"];
    const reservations: number[][] = [];
    const result = concatShellValues(parts, {
      assertOpen() {},
      reserve(bytes, count) { reservations.push([bytes, count]); if (reservations.length === 1) parts[1] = replacement; return { commit() {}, release() {} }; },
    });
    assert.deepEqual(shellValueBytes(result), Uint8Array.of(255, ...shellValueBytes(replacement)));
    assert.deepEqual(reservations[0], [96, 3]);
    assert.equal(reservations.length, 2);
  });

  test(`admitted concat snapshot isolates later payload mutation: ${typeof replacement === "string" ? replacement : "raw"}`, () => {
    const parts = [shellValueFromBytes(Uint8Array.of(255)), "A"];
    let reservations = 0;
    const result = concatShellValues(parts, {
      assertOpen() {},
      reserve() { reservations++; if (reservations === 2) parts[1] = replacement; return { commit() {}, release() {} }; },
    });
    assert.equal(reservations, 2);
    assert.deepEqual(shellValueBytes(result), Uint8Array.of(255, 65));
  });
}

for (const shape of ["iterator", "getter"]) {
  test(`closed concat rejects before input ${shape} observation`, () => {
    const closed = Object.freeze({ closed: true });
    const values = ["A", "B"];
    let observations = 0;
    if (shape === "iterator") values[Symbol.iterator] = function () {
      const iterator = [][Symbol.iterator]();
      iterator.next = () => { observations++; throw new Error("observed iterator"); };
      return iterator;
    };
    else Object.defineProperty(values, "0", { get() { observations++; throw new Error("observed getter"); } });
    assert.throws(() => concatShellValues(values, { assertOpen() { throw closed; }, reserve() { throw new Error("unreachable"); } }), error => error === closed);
    assert.equal(observations, 0);
    if (shape === "iterator") {
      const iterator = values[Symbol.iterator]();
      assert.equal(observations, 0);
      assert.throws(() => iterator.next(), { message: "observed iterator" });
      assert.equal(observations, 1);
    }
  });
}

test("denied snapshot admission never acquires remaining elements or an iterator", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  const denied = Object.freeze({ denied: true });
  let observations = 0;
  Object.defineProperty(values, "1", { get() { observations++; return "A"; } });
  values[Symbol.iterator] = function () {
    const iterator = [][Symbol.iterator]();
    iterator.next = () => { observations++; throw new Error("unbounded iterator"); };
    return iterator;
  };
  assert.throws(() => concatShellValues(values, {
    assertOpen() {},
    reserve(bytes, slots) { assert.equal(bytes, 96); assert.equal(slots, 3); throw denied; },
  }), error => error === denied);
  assert.equal(observations, 0);
  const iterator = values[Symbol.iterator]();
  assert.equal(observations, 0);
  assert.throws(() => iterator.next(), { message: "unbounded iterator" });
  assert.equal(observations, 1);
});

for (const mutation of ["grow", "shrink", "invalid type"]) {
  test(`snapshot admission rejects ${mutation} with one release and no commit`, () => {
    const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
    let releases = 0;
    let commits = 0;
    assert.throws(() => concatShellValues(values, {
      assertOpen() {},
      reserve() {
        if (mutation === "grow") values.push("B");
        else if (mutation === "shrink") values.pop();
        else values[1] = {} as ReturnType<typeof shellValueFromBytes>;
        return { commit() { commits++; }, release() { releases++; } };
      },
    }), TypeError);
    assert.equal(commits, 0);
    assert.equal(releases, 1);
  });
}

test("snapshot acquisition is bounded by admitted extent even when an element grows the source", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  let reads = 0;
  let releases = 0;
  Object.defineProperty(values, "1", { get() { reads++; values.push("B"); return "A"; } });
  assert.throws(() => concatShellValues(values, {
    assertOpen() {}, reserve() { return { commit() { throw new Error("unreachable"); }, release() { releases++; } }; },
  }), /extent/u);
  assert.equal(reads, 1);
  assert.equal(releases, 1);
});

test("metadata and payload commits cannot change the captured value via the source", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  let commits = 0;
  const result = concatShellValues(values, {
    assertOpen() {},
    reserve() { return { commit(object) { commits++; assert.equal(Object.isFrozen(object), true); values[1] = commits === 1 ? "BCDE" : "C"; }, release() {} }; },
  });
  assert.equal(commits, 2);
  assert.deepEqual(shellValueBytes(result), Uint8Array.of(255, 65));
});

test("snapshot acquisition and cleanup failures retain ordered falsey primary identity", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  const cleanup = new Error("snapshot release");
  Object.defineProperty(values, "1", { get() { throw undefined; } });
  let releases = 0;
  assert.throws(() => concatShellValues(values, {
    assertOpen() {}, reserve() { return { commit() {}, release() { releases++; throw cleanup; } }; },
  }), error => error instanceof AggregateError && error.errors[0] === undefined && error.errors[1] === cleanup);
  assert.equal(releases, 1);
});

test("post-admission all-string replacement releases snapshot without byte-payload admission", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  let reservations = 0;
  let releases = 0;
  const result = concatShellValues(values, {
    assertOpen() {},
    reserve() { reservations++; values[0] = "é"; return { commit() {}, release() { releases++; } }; },
  });
  assert.equal(result, "éA");
  assert.equal(reservations, 1);
  assert.equal(releases, 1);
});

test("payload denial releases the admitted snapshot and preserves falsey failure", () => {
  const cleanup = new Error("snapshot cleanup");
  let reservations = 0;
  let releases = 0;
  assert.throws(() => concatShellValues([shellValueFromBytes(Uint8Array.of(255)), "A"], {
    assertOpen() {},
    reserve() {
      if (++reservations === 2) throw 0;
      return { commit() {}, release() { releases++; throw cleanup; } };
    },
  }), error => error instanceof AggregateError && error.errors[0] === 0 && error.errors[1] === cleanup);
  assert.equal(reservations, 2);
  assert.equal(releases, 1);
});

test("snapshot-release failure also releases the uncommitted payload once", () => {
  const cleanup = new Error("snapshot cleanup");
  let reservations = 0;
  const releases = [0, 0];
  let commits = 0;
  assert.throws(() => concatShellValues([shellValueFromBytes(Uint8Array.of(255)), "A"], {
    assertOpen() {},
    reserve() {
      const index = reservations++;
      return { commit() { commits++; }, release() { releases[index]!++; if (index === 0) throw cleanup; } };
    },
  }), error => error === cleanup);
  assert.deepEqual(releases, [1, 1]);
  assert.equal(commits, 1);
});

test("mixed snapshot uses its finite numeric extent rather than a caller iterator", () => {
  const values = [shellValueFromBytes(Uint8Array.of(255)), "A"];
  values[Symbol.iterator] = function () {
    const iterator = [][Symbol.iterator]();
    iterator.next = () => { throw new Error("unbounded iterator"); };
    return iterator;
  };
  assert.deepEqual(shellValueBytes(concatShellValues(values)), Uint8Array.of(255, 65));
  const iterator = values[Symbol.iterator]();
  assert.throws(() => iterator.next(), { message: "unbounded iterator" });
});

for (const primary of [undefined, null, false, 0, "", Object.freeze({ primary: true })]) {
  test(`ordered cleanup aggregation preserves primary ${String(primary)}`, () => {
    const cleanup = new Error("release");
    let releases = 0;
    const allocation: ValueAllocation = {
      assertOpen() {},
      reserve() { return { commit() { throw primary; }, release() { releases++; throw cleanup; } }; },
    };
    assert.throws(() => shellValueFromBytes(Uint8Array.of(255), allocation), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
    assert.equal(releases, 1);
  });
}

test("text-only concat checks lifetime but leaves text accounting to the caller", () => {
  let checks = 0;
  const allocation: ValueAllocation = { assertOpen() { checks++; }, reserve() { throw new Error("text caller owns admission"); } };
  assert.equal(concatShellValues(["a", "b"], allocation), "ab");
  assert.equal(checks, 1);
  const reason = Object.freeze({ closed: true });
  assert.throws(() => concatShellValues(["a", "b"], { ...allocation, assertOpen() { throw reason; } }), error => error === reason);
});
