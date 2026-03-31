import "../../../tests/vi-shims.js";
import { mock, beforeEach } from "bun:test";

const fetchMock = mock(async () => {
  throw new Error("Unexpected fetch invocation. Provide a mock implementation.");
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    throw new Error("Unexpected fetch invocation. Provide a mock implementation.");
  });
});
