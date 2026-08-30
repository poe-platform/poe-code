import * as core from "../../src/core.js";
import { FsError as DirectFsError } from "../../src/contracts/errors.js";
import { MemoryFileSystem as DirectMemory } from "../../src/fs/memory/index.js";
import { compareResolvedEntries, registerEntryAuthority } from "../../src/fs/mount/comparison.js";
import type { EntryView } from "../../src/fs/mount/comparison.js";
import { platform, comparisonContext } from "#safe-fs-platform";
import { wrapperScenarios } from "./wrapper-scenarios.js";
import { proofScenarios } from "./proof-scenarios.js";

export async function runBrowserChecks(): Promise<string[]> {
  const checks: string[] = [];
  function check(name: string, condition: boolean): void {
    if (!condition) throw new Error(name);
    checks.push(name);
  }
  function view(): EntryView {
    return {
      filesystem: { capabilities: {} } as core.FileSystem,
      path: "/file",
      readOnly: false,
      stat: { type: "file", size: 0, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }
    };
  }
  check("no Node globals", !["process", "Buffer", "require"].some(name => name in globalThis));
  check("one constructor graph", core.FsError === DirectFsError && core.MemoryFileSystem === DirectMemory);
  const error = new core.FsError("ENOENT", { path: "/missing" });
  check("explicit portable errno", Object.hasOwn(error, "errno") && error.errno === undefined && error.code === "ENOENT");
  check("strict error identity", core.toFsError(error) === error && !core.isFsError({ code: "ENOENT" }));
  check("fixed policy operations", Object.isFrozen(platform) && Object.isFrozen(comparisonContext));
  check("no exposed policy tables", [...Object.values(platform), ...Object.values(comparisonContext)].every(value => !(value instanceof Map) && !(value instanceof WeakMap)));
  check("policy replacement refused", !Reflect.set(platform, "errno", () => 0) && !Reflect.set(comparisonContext, "active", () => false));

  const own = view();
  const peer = view();
  const independent = view();
  let resume!: () => void;
  let enter!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { enter = resolve; });
  const options = Object.freeze({});
  let retained: core.FsOptions = {};
  registerEntryAuthority(own.filesystem, async (_own, _peer, nested) => {
    retained = nested;
    enter();
    await paused;
    check("context survives await and options spread", await compareResolvedEntries(own, peer, { ...nested }) === "unknown");
    const forged: Record<symbol, unknown> = {};
    for (const key of Object.getOwnPropertySymbols(nested)) forged[key] = {};
    check("forged context is not trusted", await compareResolvedEntries(independent, peer, forged) === "distinct");
    return "same";
  });
  registerEntryAuthority(independent.filesystem, async () => "distinct");
  const pending = compareResolvedEntries(own, peer, options);
  await started;
  try { check("independent concurrent authority", await compareResolvedEntries(independent, peer, options) === "distinct"); }
  finally { resume(); }
  check("outer authority and caller options preserved", await pending === "same" && Reflect.ownKeys(options).length === 0);
  check("completed operation context expires", await compareResolvedEntries(independent, peer, retained) === "distinct");
  const rejected = view();
  const authorityFailure = new Error("authority rejected");
  registerEntryAuthority(rejected.filesystem, async (_own, _peer, nested) => {
    retained = nested;
    throw authorityFailure;
  });
  try { await compareResolvedEntries(rejected, peer); throw new Error("expected authority failure"); }
  catch (failure) { check("authority failure identity", failure === authorityFailure); }
  check("failed operation context expires", await compareResolvedEntries(independent, peer, retained) === "distinct");

  const hostile = view();
  let calls = 0;
  hostile.filesystem.compareEntry = async () => { calls++; await compareResolvedEntries(hostile, peer); return "same"; };
  try { await compareResolvedEntries(hostile, peer); throw new Error("expected unsupported authority"); }
  catch (failure) { check("discarded-options callback refused", failure instanceof core.FsError && failure.code === "ENOTSUP" && calls === 0); }
  const memory = new core.MemoryFileSystem();
  memory.compareEntry = async () => { calls++; return "same"; };
  try { await compareResolvedEntries({ ...view(), filesystem: memory }, peer); throw new Error("expected unsupported authority"); }
  catch (failure) { check("replaced memory authority refused", failure instanceof core.FsError && failure.code === "ENOTSUP" && calls === 0); }

  const controller = new AbortController();
  const reason = { cancellation: true };
  const cancelling = view();
  registerEntryAuthority(cancelling.filesystem, async () => { await Promise.resolve(); controller.abort(reason); return "same"; });
  try { await compareResolvedEntries(cancelling, peer, { signal: controller.signal }); throw new Error("expected cancellation"); }
  catch (failure) { check("cancellation reason identity", failure === reason); }

  const properties = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength><d:getetag>"tag"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
  const identity = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop><d:resource-id><d:href>urn:uuid:00000000-0000-0000-0000-000000000001</d:href></d:resource-id></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
  let explicitRequests = true;
  const fetch: core.WebDavFetch = async (_url, init) => {
    explicitRequests &&= init.credentials === "omit" && init.redirect === "manual";
    return new Response(String(init.body).includes("<d:resource-id/>") ? identity : properties, { status: 207 });
  };
  const left = new core.WebDavFileSystem({ baseUrl: "https://left.invalid/dav/", fetch });
  const right = new core.WebDavFileSystem({ baseUrl: "https://right.invalid/dav/", fetch });
  check("WebDAV protocol identity through readonly", await left.compareEntry("/file", new core.ReadOnlyFileSystem(right), "/file") === "same");
  check("WebDAV explicit credential and redirect policy", explicitRequests);
  const configured = { baseUrl: "https://example.invalid/dav/", fetch, compareEntry: async () => { calls++; return "same"; } };
  try { new core.WebDavFileSystem(configured as unknown as core.WebDavFileSystemOptions); throw new Error("expected unsupported configuration"); }
  catch (failure) { check("configured callback rejected at construction", failure instanceof core.FsError && failure.code === "ENOTSUP" && calls === 0); }
  left.compareEntry = async () => { calls++; return "same"; };
  try { await compareResolvedEntries({ ...view(), filesystem: left }, peer); throw new Error("expected unsupported replacement"); }
  catch (failure) { check("replaced WebDAV callback rejected", failure instanceof core.FsError && failure.code === "ENOTSUP" && calls === 0); }

  for (const scenario of [...proofScenarios, ...wrapperScenarios]) {
    await scenario.run();
    checks.push(scenario.name);
  }
  return checks;
}
