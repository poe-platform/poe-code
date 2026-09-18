import { finishCleanup } from "../contracts/cleanup.js";
import type { FileSystem } from "../contracts/filesystem.js";
import { toByteSource } from "../contracts/io.js";
import { validatePath } from "../contracts/virtual-path.js";
import { withObjectFileDescriptors } from "../fs/object-publication/index.js";
import type { ObjectFilePublicationStore, ObjectFileVersion } from "../fs/object-publication/index.js";

export interface ObjectFilePublicationConformanceFixture {
  readonly fs: FileSystem;
  readonly store: ObjectFilePublicationStore;
  readonly root: string;
  dispose(): void | Promise<void>;
}

export interface ObjectFilePublicationConformanceOptions {
  readonly createFixture: () => ObjectFilePublicationConformanceFixture | Promise<ObjectFilePublicationConformanceFixture>;
  readonly requireStaging?: boolean;
}

export interface ObjectFilePublicationConformanceCase {
  readonly name: string;
  run(): Promise<void>;
}

interface Context {
  fixture: ObjectFilePublicationConformanceFixture;
  path(name: string): string;
  track<Value extends { close(): Promise<void> }>(value: Value): Value;
  publish(path: string, revision: string | null, bytes: Uint8Array): Promise<ObjectFileVersion>;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytes(actual: Uint8Array, expected: Uint8Array): void {
  check(actual instanceof Uint8Array && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]), "object publication returned incorrect bytes");
}

function conflict(reason: unknown): void {
  check(typeof reason === "object" && reason !== null && "code" in reason
    && (reason.code === "EAGAIN" || reason.code === "EEXIST"), "conditional publication must report a version/create conflict");
}

export function createObjectFilePublicationConformanceCases(options: ObjectFilePublicationConformanceOptions): ObjectFilePublicationConformanceCase[] {
  const cases: Array<{ name: string; run(context: Context): Promise<void> }> = [
    {
      name: "object publication: immutable reads survive replacement",
      async run({ fixture, path, track, publish }) {
        const name = path("pinned");
        const initial = await publish(name, null, new Uint8Array([1, 2, 3, 4]));
        const acquired = await fixture.store.acquire(name, { access: "read" });
        check(acquired, "published file could not be acquired");
        track(acquired);
        check(acquired.revision === initial.revision, "acquisition did not observe the published namespace revision");
        const replacement = await publish(name, initial.revision, new Uint8Array([5, 6, 7]));
        check(replacement.revision !== initial.revision, "namespace revisions must change on publication");
        bytes(await acquired.read(1, 2), new Uint8Array([2, 3]));
        const mutable = await acquired.read(0, 4);
        mutable.fill(0);
        bytes(await acquired.read(0, 4), new Uint8Array([1, 2, 3, 4]));
        bytes(await fixture.fs.readFile(name), new Uint8Array([5, 6, 7]));
      },
    },
    {
      name: "object publication: exclusive create has exactly one winner",
      async run({ fixture, path, publish }) {
        const name = path("exclusive");
        const results = await Promise.allSettled([
          publish(name, null, new Uint8Array([1])), publish(name, null, new Uint8Array([2])),
        ]);
        const winners = results.filter(result => result.status === "fulfilled");
        const failures = results.filter(result => result.status === "rejected");
        check(winners.length === 1 && failures.length === 1, "atomic creation must admit exactly one concurrent writer");
        conflict(failures[0]!.reason);
        bytes(await fixture.fs.readFile(name), new Uint8Array([results[0]!.status === "fulfilled" ? 1 : 2]));
      },
    },
    {
      name: "object publication: stale updates cannot replace an acknowledged generation",
      async run({ fixture, path, publish }) {
        const name = path("conditional");
        const initial = await publish(name, null, new Uint8Array([0]));
        const results = await Promise.allSettled([
          publish(name, initial.revision, new Uint8Array([1])),
          publish(name, initial.revision, new Uint8Array([2])),
        ]);
        const failures = results.filter(result => result.status === "rejected");
        check(results.filter(result => result.status === "fulfilled").length === 1 && failures.length === 1,
          "conditional publication admitted conflicting revisions");
        conflict(failures[0]!.reason);
        bytes(await fixture.fs.readFile(name), new Uint8Array([results[0]!.status === "fulfilled" ? 1 : 2]));
      },
    },
    {
      name: "object publication: cancelled creation does not publish",
      async run({ fixture, path, track }) {
        const name = path("cancelled");
        const controller = new AbortController();
        const reason = new Error("conformance cancellation");
        controller.abort(reason);
        let rejected = false;
        try {
          track(await fixture.store.publish!(name, null, toByteSource(new Uint8Array([1])), {
            signal: controller.signal, size: 1, mode: 0o600,
          }));
        } catch (error) { check(error === reason, "publication must preserve cancellation identity"); rejected = true; }
        check(rejected, "cancelled publication succeeded");
        const visible = await fixture.store.acquire(name, { access: "read" });
        if (visible) track(visible);
        check(visible === undefined, "cancelled creation left a published key");
      },
    },
    {
      name: "object publication: descriptor updates flush conditionally",
      async run({ fixture, path, track, publish }) {
        const name = path("descriptor");
        await publish(name, null, new Uint8Array([1, 2, 3, 4]));
        const fs = withObjectFileDescriptors(fixture.fs, fixture.store, { chunkBytes: 4, maxStagedBytes: 16 });
        const descriptor = track(await fs.open!(name, { access: "readwrite" }));
        check(descriptor.capabilities.publication === "conditional", "descriptor publication profile was lost");
        await descriptor.write(new Uint8Array([7]), 1);
        bytes(await fixture.fs.readFile(name), new Uint8Array([1, 2, 3, 4]));
        await descriptor.sync(false);
        bytes(await fixture.fs.readFile(name), new Uint8Array([1, 7, 3, 4]));
        await descriptor.truncate(2);
        await descriptor.truncate(4);
        await descriptor.sync(false);
        bytes(await fixture.fs.readFile(name), new Uint8Array([1, 7, 0, 0]));
      },
    },
  ];
  if (options.requireStaging) cases.push(
    {
      name: "object staging: private pages have owned reads and truncation semantics",
      async run({ fixture, path, track }) {
        const name = path("staged");
        const staging = track(await fixture.store.createStaging!(name, { chunkBytes: 4, maxFileBytes: 16 }));
        const sibling = track(await fixture.store.createStaging!(name, { chunkBytes: 4, maxFileBytes: 16 }));
        check(await staging.readPage(0) === undefined, "new staging contains an unowned page");
        const input = new Uint8Array([1, 2, 3, 4]);
        await staging.writePage(0, input);
        input.fill(0);
        const retained = await staging.readPage(0);
        check(retained !== undefined, "staging lost an acknowledged page");
        bytes(retained, new Uint8Array([1, 2, 3, 4]));
        retained.fill(0);
        bytes((await staging.readPage(0))!, new Uint8Array([1, 2, 3, 4]));
        check(await sibling.readPage(0) === undefined, "staging leaked across descriptors");
        await staging.writePage(2, new Uint8Array([5, 6, 7, 8]));
        await staging.truncate(2);
        bytes((await staging.readPage(0))!, new Uint8Array([1, 2, 0, 0]));
        check(await staging.readPage(2) === undefined, "truncate retained a removed page");
        const visible = await fixture.store.acquire(name, { access: "read" });
        if (visible) track(visible);
        check(visible === undefined, "private staging published a namespace entry");
      },
    },
    {
      name: "object staging: cancelled writes preserve acknowledged pages",
      async run({ fixture, path, track }) {
        const staging = track(await fixture.store.createStaging!(path("stage-cancelled"), { chunkBytes: 4, maxFileBytes: 16 }));
        await staging.writePage(0, new Uint8Array([1, 2, 3, 4]));
        const controller = new AbortController();
        const reason = new Error("staging cancellation");
        controller.abort(reason);
        let rejected = false;
        try { await staging.writePage(0, new Uint8Array(4), { signal: controller.signal }); }
        catch (error) { check(error === reason, "staging must preserve cancellation identity"); rejected = true; }
        check(rejected, "cancelled staging write succeeded");
        bytes((await staging.readPage(0))!, new Uint8Array([1, 2, 3, 4]));
      },
    },
    {
      name: "object staging: writes larger than memory stay private until conditional sync",
      async run({ fixture, path, track, publish }) {
        const name = path("stage-descriptor");
        await publish(name, null, new Uint8Array([1, 2, 3, 4]));
        const fs = withObjectFileDescriptors(fixture.fs, fixture.store, { chunkBytes: 4, maxStagedBytes: 4, maxStagedPages: 1, maxFileBytes: 16 });
        const descriptor = track(await fs.open!(name, { access: "readwrite" }));
        const content = new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        await descriptor.write(content, 0);
        bytes(await fixture.fs.readFile(name), new Uint8Array([1, 2, 3, 4]));
        const buffer = new Uint8Array(content.length);
        check(await descriptor.read(buffer, 0) === buffer.length, "staging read was incomplete");
        bytes(buffer, content);
        await descriptor.sync(false);
        bytes(await fixture.fs.readFile(name), content);
      },
    },
  );
  return cases.map(entry => ({
    name: entry.name,
    async run() {
      const fixture = await options.createFixture();
      const resources: Array<{ close(): Promise<void> }> = [];
      let failed = false;
      try {
        validatePath(fixture.root);
        check(fixture.root.startsWith("/"), "conformance fixture root must be absolute");
        check(typeof fixture.store.publish === "function", "conformance requires authoritative conditional publication");
        if (options.requireStaging) check(typeof fixture.store.createStaging === "function", "conformance requires private object staging");
        const root = fixture.root.endsWith("/") ? fixture.root.slice(0, -1) : fixture.root;
        const track = <Value extends { close(): Promise<void> }>(value: Value): Value => {
          resources.push(value);
          return value;
        };
        await entry.run({ fixture, path: name => `${root}/${name}`, track,
          async publish(path, revision, data) {
            return track(await fixture.store.publish!(path, revision, toByteSource(data), { size: data.length, mode: 0o600 }));
          },
        });
      } catch (error) { failed = true; throw error; }
      finally {
        await finishCleanup(async () => {
          const closed = await Promise.allSettled(resources.map(resource => resource.close()));
          const rejected = closed.find(result => result.status === "rejected");
          await finishCleanup(() => fixture.dispose(), rejected !== undefined);
          if (rejected?.status === "rejected") throw rejected.reason;
        }, failed);
      }
    },
  }));
}
