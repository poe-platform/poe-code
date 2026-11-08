import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { mediaExtractionFixture } from "../tests/fixtures/media-extraction.js";
import { extractMedia } from "./media-extraction.js";
import { openRetainedMediaExtraction } from "./retained-media-extraction.js";
import { readPackage } from "./package-reader.js";
import { resourceContext } from "./resource-limits.js";
import { digest } from "./retained-values.js";
import { streamJson } from "./retained-output.js";

for (const external of [false, true])
  for (const split of [false, true])
    for (const options of [
      {},
      { deduplicate: true },
      { maxOutputs: 1 },
      { maxOutputBytes: 13 },
      { slide: 1, shape: "../../private-2.exe" }
    ])
      it(`retains media extraction ${JSON.stringify({ external, split, options })}`, async () => {
        const bytes = mediaExtractionFixture(external, "video/mp4", split),
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
            const bytes = buffered.get(part),
              reuse = new Uint8Array(4096);
            for (let p = 0; p < bytes.length; p += 4096) {
              const n = Math.min(4096, bytes.length - p);
              reuse.set(bytes.subarray(p, p + n));
              yield reuse.subarray(0, n);
              reuse.fill(255);
            }
          }
        };
        let expected, error;
        try {
          expected = await extractMedia(bytes, options, context);
        } catch (failure) {
          error = failure;
        }
        const attempt = openRetainedMediaExtraction(
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
          await expect(attempt).rejects.toMatchObject({
            code: (error as { code: string }).code,
            message: (error as Error).message
          });
        else {
          const reader = await attempt,
            actual = [];
          try {
            for await (const member of reader.members()) {
              let json = "";
              for await (const bytes of streamJson({
                name: member.name,
                sha256: member.sha256,
                contentType: member.contentType,
                sourceParts: member.sourceParts(),
                occurrenceIds: member.occurrenceIds()
              }))
                json += new TextDecoder().decode(bytes);
              const chunks = [];
              for await (const bytes of member.bytes()) chunks.push(new Uint8Array(bytes));
              actual.push({ ...JSON.parse(json), bytes: new Uint8Array(Buffer.concat(chunks)) });
            }
            expect(actual).toEqual(expected);
            expect(reader.count).toBe(expected!.length);
          } finally {
            await reader.close();
          }
        }
        expect(await fs.readdir("/")).toEqual([]);
      });
