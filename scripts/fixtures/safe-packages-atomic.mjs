import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createAtomicFileSystemConformance } from "@poe-platform/safe-fs/testing/atomic";

const cases = createAtomicFileSystemConformance({
  createFixture() {
    const fs = createMemoryFileSystem();
    return { fs, root: "/", dispose() {} };
  },
  includeSymlinks: true,
});
if (!cases.length) throw new Error("Atomic filesystem conformance has no cases");
for (const entry of cases) await entry.run();
