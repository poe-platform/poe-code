import { mockFetch } from "./mock.js";
import type {
  MockFetchHandle,
  MockFetchOptions,
  MockFetchFixtures,
  MockFixtureEntry,
  OnUnmocked,
  RequestRecord
} from "./mock.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredHandlePromise: Promise<MockFetchHandle> = mockFetch({
  spec: { openapi: "3.0.0", info: { title: "T", version: "0" }, paths: {} },
  fixtures: { whoami: { body: { handle: "x" } } } satisfies MockFetchFixtures,
  onUnmocked: "throw" satisfies OnUnmocked
});

void ignoredHandlePromise.then((handle) => {
  void handle.fetch;
  void handle.requests;
  void handle.reset;
});

const ignoredOptions: MockFetchOptions = { spec: "./openapi.json" };
void ignoredOptions;

const ignoredFixture: MockFixtureEntry = { status: 200, body: { ok: true } };
void ignoredFixture;

type ignoredRecordExport = AssertAssignable<
  {
    method: string;
    path: string;
    operationId: string;
    headers: Record<string, string>;
    body: unknown;
    at: Date;
  },
  RequestRecord
>;
