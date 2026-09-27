import { expect, test } from "vitest";
import { guardTraceRecord, traceRecordBytes } from "../src/browser-trace-record.js";

test.each([{}, [], [undefined, null, true, -0, Infinity], { text: 'é文😀\ud800\udc00\ud800\u0000\n\\"' }, { response: { headers: [{ name: "set-cookie", value: "hello" }], optional: undefined } }])("counts JSON bytes without changing the record", value => {
  expect(traceRecordBytes(value, 10000)).toBe(Buffer.byteLength(JSON.stringify(value)));
});

test("admits replacement, array append, removal and escaped Unicode before retaining the mutation", () => {
  const raw = { response: { headers: [] as { value: string }[] } };
  let retained = traceRecordBytes(raw, 128);
  const { value, stop } = guardTraceRecord(raw, 128, bytes => {
    if (bytes > 128) return false;
    retained = bytes; return true;
  });
  value.response.headers.push({ value: '文\n\\"' });
  expect(retained).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(raw.response.headers).toEqual([]);
  value.response.headers[0]!.value = "x".repeat(256);
  expect(value.response.headers[0]!.value).toBe('文\n\\"');
  value.response.headers.pop();
  expect(retained).toBe(Buffer.byteLength(JSON.stringify(value)));
  stop();
  value.response.headers.push({ value: "late" });
  expect(raw.response.headers).toEqual([]);
  expect(value.response.headers).toEqual([]);
});

test("retirement clears owned payloads without changing borrowed browser headers", () => {
  const headers = [{ value: "borrowed" }];
  const { value, stop } = guardTraceRecord({ response: { headers } }, 1024, () => true);
  value.response.headers[0]!.value = "owned";
  expect(headers[0]!.value).toBe("borrowed");
  stop();
  expect(value.response.headers).toEqual([]);
  expect(headers).toEqual([{ value: "borrowed" }]);
});

test("replacing metadata clears detached callbacks and refuses growth outside the current record", () => {
  const { value } = guardTraceRecord({ response: { headers: [{ value: "old" }] } }, 128, bytes => bytes <= 128);
  const detached = value.response;
  value.response = { headers: [] };
  expect(detached.headers).toEqual([]);
  detached.headers.push({ value: "x".repeat(256) });
  expect(detached.headers).toEqual([]);
  expect(value.response.headers).toEqual([]);
});
