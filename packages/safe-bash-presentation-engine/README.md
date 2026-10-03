# Presentation operations

Shared PowerPoint package inspection, editing and byte transport for document
commands and conversion. This internal engine is bundled into the existing
Safe Bash package; it is not installed separately.

```ts
import { pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

shell.use(pptxCommands());
```

The command supports an injected engine, cancellation and explicit argument
limits. Document operations preserve the existing presentation, OPC and byte
contracts. Shared resource limits remain unlimited unless explicitly configured;
external links are never fetched implicitly.

Custom engines can use `openPackageArchive` with a retained range source and an
explicit `workingStorage: { fs, directory, cacheBytes }` capability. It streams
member bytes, keeps package indexes in caller-backed storage, and stages rewrites
before writing an output sink. Unchanged members retain compressed payloads and
ZIP metadata. Always close the archive; the caller still owns the input and sink.
The default working cache is 1 MiB. Large workloads require an external safe-fs
backend because memory filesystems also keep spilled data in RAM.

This archive API does not yet make the default command or synchronous presentation
model a bounded-memory execution path; those operations still use buffered APIs.
