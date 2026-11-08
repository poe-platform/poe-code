import * as core from "../../src/core.js";
import type { EntryView } from "../../src/fs/mount/comparison.js";
import {
  getOwnedWebDavEntry, ownedResponseIdentifier, recordOwnedResourceStat, registerOwnedResourceResponse
} from "../../src/fs/webdav/resource-id.js";

function view(): EntryView {
  return {
    filesystem: new core.MemoryFileSystem(), path: "/file", readOnly: false,
    stat: { type: "file", size: 0, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }
  };
}

function check(condition: boolean): void {
  if (!condition) throw new Error("trusted observation invariant failed");
}

export const proofScenarios = [
  {
    name: "public core never exposes authority writers or policy state",
    async run(): Promise<void> {
      for (const name of ["registerOwnedResourceResponse", "registerEntryAuthority", "recordS3Observation", "queryS3Head", "platform", "comparisonContext"]) {
        check(!(name in core));
      }
    }
  },
  {
    name: "WebDAV proof is bound to response, stat, filesystem and path identities",
    async run(): Promise<void> {
      const response = new Response();
      const own = view();
      const entry = { storage: {}, resource: {}, identifier: "urn:proof:original" };
      const entries = new Map([["/file", entry]]);
      registerOwnedResourceResponse(response, entries);
      entries.set("/file", { storage: {}, resource: {}, identifier: "urn:proof:forged" });
      check(ownedResponseIdentifier(response, "/file") === entry.identifier);
      recordOwnedResourceStat(response, own.filesystem, own.path, own.stat);
      check(getOwnedWebDavEntry(own) === entry);
      check(getOwnedWebDavEntry({ ...own, stat: { ...own.stat } }) === undefined);
      check(getOwnedWebDavEntry({ ...own, path: "/other" }) === undefined);
      check(getOwnedWebDavEntry({ ...own, filesystem: new core.MemoryFileSystem() }) === undefined);
      const clone = view();
      recordOwnedResourceStat(response.clone(), clone.filesystem, clone.path, clone.stat);
      check(getOwnedWebDavEntry(clone) === undefined);
      let rejected = false;
      try { registerOwnedResourceResponse(response, entries); }
      catch (error) { rejected = error instanceof TypeError; }
      check(rejected);
    }
  },
  {
    name: "concurrent WebDAV observations cannot cross-bind shared stat objects",
    async run(): Promise<void> {
      const first = view();
      const second = { ...view(), stat: first.stat };
      const response = new Response();
      const otherResponse = new Response();
      const entry = { storage: {}, resource: {}, identifier: "urn:proof:first" };
      const other = { storage: {}, resource: {}, identifier: "urn:proof:second" };
      registerOwnedResourceResponse(response, new Map([["/file", entry]]));
      registerOwnedResourceResponse(otherResponse, new Map([["/file", other]]));
      let resume!: () => void;
      const paused = new Promise<void>(resolve => { resume = resolve; });
      const pending = (async () => {
        await paused;
        recordOwnedResourceStat(response, first.filesystem, first.path, first.stat);
      })();
      try {
        recordOwnedResourceStat(otherResponse, second.filesystem, second.path, second.stat);
        check(getOwnedWebDavEntry(second) === other);
      } finally { resume(); }
      await pending;
      check(getOwnedWebDavEntry(first) === entry);
      check(getOwnedWebDavEntry(second) === undefined);
    }
  }
];
