import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { mediaFixture } from "../tests/fixtures/media.js";
import { readMedia } from "./media.js";
import { readPackage } from "./package-reader.js";
import { resourceContext } from "./resource-limits.js";
import { digest } from "./retained-values.js";
import { streamJson } from "./retained-output.js";
import { openRetainedMedia } from "./retained-media.js";

for (const variant of [
  {},
  { strict: true },
  { poster: false },
  { broken: true },
  { missing: true },
  { notes: true },
  { mediaOnly: true },
  { captionLink: true },
  { spoof: true }
])
  for (const options of [
    {},
    { slide: 1, shape: "Clip 2" },
    { scope: "shared" as const },
    { scope: "notes" as const, slide: 1 }
  ])
    it(`retains media inventory and diagnostics ${JSON.stringify({ variant, options })}`, async () => {
      const bytes = mediaFixture(variant),
        context = resourceContext({}),
        fs = createMemoryFileSystem();
      const buffered = await readPackage(bytes, context);
      const archive = {
        async *parts() {
          yield* buffered.names;
        },
        async has(part: string) {
          return buffered.names.includes(part);
        },
        async byteLength(part: string) {
          return buffered.get(part).length;
        },
        async *read(part: string) {
          const bytes = buffered.get(part),
            reuse = new Uint8Array(4096);
          for (let p = 0; p < bytes.length; p += reuse.length) {
            const n = Math.min(reuse.length, bytes.length - p);
            reuse.set(bytes.subarray(p, p + n));
            yield reuse.subarray(0, n);
            reuse.fill(255);
          }
        }
      };
      let expected, error;
      try {
        expected = await readMedia(bytes, options, context);
      } catch (failure) {
        error = failure;
      }
      const promise = openRetainedMedia(
        archive,
        await digest(
          (async function* () {
            yield bytes;
          })()
        ),
        options,
        { ...context, workingStorage: { fs, directory: "/", cacheBytes: 16384 } }
      );
      if (error)
        await expect(promise).rejects.toMatchObject({
          code: (error as { code: string }).code,
          message: (error as Error).message
        });
      else {
        const reader = await promise;
        let json = "";
        for await (const bytes of streamJson({
          occurrences: reader.occurrences(),
          media: reader.media(),
          playbackVerified: false
        }))
          json += new TextDecoder().decode(bytes);
        expect(JSON.parse(json)).toEqual(expected);
        await reader.close();
        await expect(reader.occurrences().next()).rejects.toMatchObject({ code: "invalid-handle" });
      }
      expect(await fs.readdir("/")).toEqual([]);
    });

it("keeps retained selection diagnostics readable until explicitly closed", async () => {
  const { RetainedMediaSelectionError } = await import("./retained-media.js");
  const bytes = mediaFixture(),
    context = resourceContext({}),
    buffered = await readPackage(bytes, context),
    fs = createMemoryFileSystem();
  const archive = {
    async *parts() {
      yield* buffered.names;
    },
    async has(part: string) {
      return buffered.has(part);
    },
    async byteLength(part: string) {
      return buffered.byteLength(part);
    },
    async *read(part: string) {
      yield buffered.get(part);
    }
  };
  const attempt = openRetainedMedia(
    archive,
    await digest(
      (async function* () {
        yield bytes;
      })()
    ),
    { slide: 1, shape: "absent" },
    { ...context, workingStorage: { fs, directory: "/", cacheBytes: 16384 } }
  );
  const error = await attempt.catch((error) => error);
  expect(error).toBeInstanceOf(RetainedMediaSelectionError);
  try {
    const candidates = [];
    for await (const location of error.candidates()) candidates.push(location);
    expect(candidates).toEqual([]);
  } finally {
    await error.close();
    await error.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});
