import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, WD_STYLE_TYPE } from "./styles-model.js";
import { Image } from "./image-model.js";
import { CancellationError, InputTypeError } from "./archive.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("creates with omitted context and null input, with synchronous live formatting", async () => {
  const pending = openDocumentStyleModel(null);
  expect(pending).toBeInstanceOf(Promise);
  const model = await pending;
  const style = model.styles.add_style("Dune", WD_STYLE_TYPE.PARAGRAPH);
  style.font.bold = false;
  expect(style.font.bold).toBe(false);
  expect(style.font).not.toBeInstanceOf(Promise);
  const volume = Volume.fromJSON({ "/output": "" });
  const save = model.save({
    async write(bytes) {
      volume.appendFileSync("/output", bytes);
    }
  });
  expect(save).toBeInstanceOf(Promise);
  await save;
  expect(volume.statSync("/output").size).toBeGreaterThan(0);
});

it("owns stream chunks before advancing and closes failed source admission", async () => {
  const initial = await openDocumentStyleModel(undefined, textContext);
  const volume = Volume.fromJSON({ "/input": "" });
  await initial.save({
    async write(bytes) {
      volume.appendFileSync("/input", bytes);
    }
  });
  const bytes = new Uint8Array(volume.readFileSync("/input") as Uint8Array);
  const loaded = await openDocumentStyleModel(
    {
      async *open() {
        yield bytes;
        bytes.fill(0);
      }
    },
    textContext
  );
  expect(loaded.styles.at("Normal").name).toBe("Normal");
  let closed = false;
  const failure = new Error("source refused");
  await expect(
    openDocumentStyleModel(
      {
        async *open() {
          try {
            yield new Uint8Array([1]);
            throw failure;
          } finally {
            closed = true;
          }
        }
      },
      textContext
    )
  ).rejects.toBe(failure);
  expect(closed).toBe(true);
});

it("uses supplied author and UTC time without ambient discovery or mutable Date races", async () => {
  const timestamp = new Date("2025-03-04T05:06:07.987Z");
  const pending = openDocumentStyleModel(undefined, {
    ...textContext,
    timestamp,
    author: "Dune author"
  });
  timestamp.setUTCFullYear(2030);
  const model = await pending;
  const volume = Volume.fromJSON({ "/output": "" });
  await model.save({
    async write(bytes) {
      volume.appendFileSync("/output", bytes);
    }
  });
  const { readDocumentArchive } = await import("./admission.js");
  const archive = await readDocumentArchive(
    new Uint8Array(volume.readFileSync("/output") as Uint8Array),
    textContext
  );
  const core = new TextDecoder().decode(
    archive.members.find((member) => member.name === "docProps/core.xml")?.bytes
  );
  expect(core).toContain("Dune author");
  expect(core).toContain("2025-03-04T05:06:07Z");
  expect(core).not.toContain("2030");
});

it("does not discard publication cancellation in favor of the admission signal", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const controller = new AbortController();
  controller.abort();
  const write = vi.fn();
  const result = model.publish(
    { output: "-" },
    {
      ...textContext,
      signal: controller.signal,
      stdout: { write },
      encoding: { order: "input", compression: "store" }
    }
  );
  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toBeInstanceOf(CancellationError);
  expect(write).not.toHaveBeenCalled();
});

it("rejects invalid context time and malformed save targets asynchronously", async () => {
  const creation = openDocumentStyleModel(undefined, { ...textContext, timestamp: new Date(NaN) });
  expect(creation).toBeInstanceOf(Promise);
  await expect(creation).rejects.toBeInstanceOf(InputTypeError);
  const model = await openDocumentStyleModel(undefined, textContext);
  await expect(model.save(null as never)).rejects.toBeInstanceOf(InputTypeError);
  const image = Image.from_blob(rasterPng(), { timestamp: new Date(NaN) });
  expect(image).toBeInstanceOf(Promise);
  await expect(image).rejects.toBeInstanceOf(InputTypeError);
});

it("refuses publication when live model mutation overtakes asynchronous serialization", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const write = vi.fn();
  const pending = model.save({ write });
  model.styles.add_style("Later mutation", WD_STYLE_TYPE.PARAGRAPH);
  await expect(pending).rejects.toMatchObject({ code: "conflict" });
  expect(write).not.toHaveBeenCalled();
});

it("admits paths only with the matching explicit capability and captured path", async () => {
  const initial = await openDocumentStyleModel(undefined, textContext);
  const volume = Volume.fromJSON({ "/input": "" });
  await initial.save({
    async write(bytes) {
      volume.appendFileSync("/input", bytes);
    }
  });
  const open = vi.fn(async function* (path: string) {
    yield new Uint8Array(volume.readFileSync(path) as Uint8Array);
  });
  const context = { ...textContext, binaryResolver: { capability: "dune-vfs", open } };
  await expect(
    openDocumentStyleModel({ path: "/input", capability: "other" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(open).not.toHaveBeenCalled();
  const path = { path: "/input", capability: "dune-vfs" };
  const pending = openDocumentStyleModel(path, context);
  path.path = "/missing";
  expect((await pending).styles.at("Normal").name).toBe("Normal");
  expect(open).toHaveBeenCalledWith(
    "/input",
    expect.objectContaining({ maxBytes: textContext.limits.maxArchiveBytes })
  );
});

it("captures supplied bytes before callers can mutate their input", async () => {
  const initial = await openDocumentStyleModel(undefined, textContext);
  const volume = Volume.fromJSON({ "/input": "" });
  await initial.save({
    async write(bytes) {
      volume.appendFileSync("/input", bytes);
    }
  });
  const bytes = new Uint8Array(volume.readFileSync("/input") as Uint8Array);
  const pending = openDocumentStyleModel(bytes, textContext);
  bytes.fill(0);
  expect((await pending).styles.at("Normal").name).toBe("Normal");
});

it("retains tighter publication limits instead of silently ignoring them", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const write = vi.fn();
  await expect(
    model.publish(
      { output: "-" },
      {
        ...textContext,
        limits: { ...textContext.limits, maxArchiveBytes: 512 },
        stdout: { write },
        encoding: { order: "input", compression: "store" }
      }
    )
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(write).not.toHaveBeenCalled();
});

it("rejects model context getters without discovering ambient values", async () => {
  const getter = vi.fn(() => "host author");
  const context = Object.defineProperty({}, "author", { get: getter });
  await expect(openDocumentStyleModel(undefined, context)).rejects.toBeInstanceOf(InputTypeError);
  await expect(Image.from_blob(rasterPng(), context)).rejects.toBeInstanceOf(InputTypeError);
  expect(getter).not.toHaveBeenCalled();
});

it("rejects explicit invalid identity and cancellation instead of taking defaults", async () => {
  for (const context of [{ author: null }, { signal: null }, { initials: 0 }, { metrics: {} }]) {
    await expect(openDocumentStyleModel(undefined, context as never)).rejects.toBeInstanceOf(
      InputTypeError
    );
  }
});

it("prevents live mutation while an explicit sink owns the final commit", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  let entered!: () => void, finish!: () => void;
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pending = model.save({
    async write() {
      entered();
      await waiting;
    }
  });
  await entry;
  try {
    expect(() => model.styles.add_style("During commit", WD_STYLE_TYPE.PARAGRAPH)).toThrow(
      expect.objectContaining({ code: "conflict" })
    );
  } finally {
    finish();
    await pending;
  }
  expect(model.styles.add_style("After commit", WD_STYLE_TYPE.PARAGRAPH).name).toBe("After commit");
});

it("rejects malformed resolver capabilities before invocation", async () => {
  await expect(
    openDocumentStyleModel(undefined, { binaryResolver: { capability: "missing-method" } } as never)
  ).rejects.toBeInstanceOf(InputTypeError);
});

it("rejects inherited or nested context getters without invoking them", async () => {
  const getter = vi.fn(() => "host value");
  const inherited = Object.create(Object.defineProperty({}, "author", { get: getter }));
  const resolver = Object.defineProperty({ capability: "vfs" }, "open", { get: getter });
  const limits = Object.defineProperty({ ...textContext.limits }, "maxArchiveBytes", {
    get: getter
  });
  for (const context of [inherited, { binaryResolver: resolver }, { limits }]) {
    await expect(openDocumentStyleModel(undefined, context)).rejects.toBeInstanceOf(InputTypeError);
  }
  expect(getter).not.toHaveBeenCalled();
});

it("honors cancellation before internal staged publication", async () => {
  const { documentSession } = await import("./archive.js");
  const stage = vi.fn();
  const { readDocumentArchive } = await import("./admission.js");
  const session = {
    generation: 0,
    stage,
    read: (bytes: Uint8Array) => readDocumentArchive(bytes, textContext)
  };
  const model = await openDocumentStyleModel(undefined, {
    ...textContext,
    [documentSession]: session
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    model.publish(
      { dryRun: true },
      {
        ...textContext,
        [documentSession]: session,
        signal: controller.signal,
        encoding: { order: "input", compression: "store" }
      }
    )
  ).rejects.toBeInstanceOf(CancellationError);
  expect(stage).not.toHaveBeenCalled();
});

it("refuses a stale in-place VFS identity without touching owned input or staging", async () => {
  const volume = Volume.fromJSON({ "/work/input": "earlier bytes" });
  const identityScope = {};
  const identity = (path: string) => {
    const stat = volume.lstatSync(path);
    return {
      type: stat.isDirectory() ? ("directory" as const) : ("file" as const),
      size: stat.size,
      mode: stat.mode,
      ino: stat.ino,
      dev: stat.dev,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      atimeMs: stat.atimeMs,
      nlink: stat.nlink,
      identityScope,
      revision: stat.size
    };
  };
  const input = { path: "/work/input", stat: identity("/work/input") };
  volume.writeFileSync("/work/input", "newer unowned bytes");
  const createStagedFile = vi.fn(),
    publishStagedFile = vi.fn(),
    removeStagedFile = vi.fn();
  const filesystem = {
    capabilities: { atomicFileStaging: true, write: true },
    lstat: async (path: string) => identity(path),
    createStagedFile,
    publishStagedFile,
    removeStagedFile
  };
  const model = await openDocumentStyleModel(undefined, textContext);
  await expect(
    model.publish(
      { inPlace: true, input },
      {
        ...textContext,
        filesystem: filesystem as never,
        encoding: { order: "input", compression: "store" }
      }
    )
  ).rejects.toMatchObject({ code: "conflict" });
  expect(volume.readFileSync("/work/input", "utf8")).toBe("newer unowned bytes");
  expect(createStagedFile).not.toHaveBeenCalled();
  expect(publishStagedFile).not.toHaveBeenCalled();
  expect(removeStagedFile).not.toHaveBeenCalled();
});

it("closes a borrowed stream on cancellation without a second source advance", async () => {
  const controller = new AbortController();
  let closed = false,
    advanced = false;
  const pending = openDocumentStyleModel(
    {
      async *open() {
        try {
          controller.abort();
          yield new Uint8Array([1]);
          advanced = true;
        } finally {
          closed = true;
        }
      }
    },
    { ...textContext, signal: controller.signal }
  );
  await expect(pending).rejects.toBeInstanceOf(CancellationError);
  expect(closed).toBe(true);
  expect(advanced).toBe(false);
});

it("preserves explicit byte-source method receivers for image admission", async () => {
  const source = {
    async *open() {
      expect(this).toBe(source);
      yield rasterPng();
    }
  };
  expect((await Image.from_file(source)).content_type).toBe("image/png");
});

it("releases commit ownership after a sink failure", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  await expect(
    model.save({
      async write() {
        throw new Error("injected refusal");
      }
    })
  ).rejects.toMatchObject({ code: "sink-failure" });
  expect(model.styles.add_style("Recovered", WD_STYLE_TYPE.PARAGRAPH).name).toBe("Recovered");
});

it("cleans its acquired VFS stage when a model edit overtakes staging", async () => {
  const volume = Volume.fromJSON({ "/work/output": "unowned output" });
  const model = await openDocumentStyleModel(undefined, textContext);
  const identityScope = {};
  const identity = (path: string) => {
    const stat = volume.lstatSync(path);
    return {
      type: stat.isDirectory() ? ("directory" as const) : ("file" as const),
      size: stat.size,
      mode: stat.mode,
      ino: stat.ino,
      dev: stat.dev,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      atimeMs: stat.atimeMs,
      nlink: stat.nlink,
      identityScope,
      revision: stat.size
    };
  };
  const publishStagedFile = vi.fn();
  const removeStagedFile = vi.fn(async (stage: { directory: { path: string } }) => {
    volume.rmSync(stage.directory.path, { recursive: true });
  });
  const filesystem = {
    capabilities: { atomicFileStaging: true, write: true },
    lstat: async (path: string) => identity(path),
    publishStagedFile,
    removeStagedFile,
    async createStagedFile(directory: string, name: string, content: { data: Uint8Array }) {
      volume.mkdirSync(directory);
      volume.writeFileSync(`${directory}/${name}`, content.data);
      model.styles.add_style("Overtakes stage", WD_STYLE_TYPE.PARAGRAPH);
      return {
        parent: { path: "/work", stat: identity("/work") },
        directory: { path: directory, stat: identity(directory) },
        file: { path: `${directory}/${name}`, stat: identity(`${directory}/${name}`) }
      };
    }
  };
  await expect(
    model.publish(
      { output: "/work/output", force: true },
      {
        ...textContext,
        filesystem: filesystem as never,
        encoding: { order: "input", compression: "store" }
      }
    )
  ).rejects.toMatchObject({ code: "conflict", published: [] });
  expect(publishStagedFile).not.toHaveBeenCalled();
  expect(removeStagedFile).toHaveBeenCalledOnce();
  expect(volume.readFileSync("/work/output", "utf8")).toBe("unowned output");
  expect(volume.readdirSync("/work")).toEqual(["output"]);
});

it("does not consult supplied metrics for model operations that need no font measurement", async () => {
  const measure = vi.fn(() => 1);
  const model = await openDocumentStyleModel(undefined, { ...textContext, metrics: { measure } });
  model.styles.add_style("Measured elsewhere", WD_STYLE_TYPE.PARAGRAPH).font.bold = true;
  expect(measure).not.toHaveBeenCalled();
});

it("refuses unrelated caller budget ledgers instead of bypassing their cumulative reservations", async () => {
  const { DocumentBudget } = await import("./budget.js");
  const model = await openDocumentStyleModel(undefined, textContext);
  const budget = new DocumentBudget({ work: 1000000 }, textContext.signal);
  budget.charge("work", 1000000);
  const write = vi.fn();
  await expect(
    model.publish(
      { output: "-" },
      {
        ...textContext,
        budget,
        stdout: { write },
        encoding: { order: "input", compression: "store" }
      }
    )
  ).rejects.toMatchObject({ code: "unsupported-publication" });
  expect(write).not.toHaveBeenCalled();
});

it("accepts lowered contexts that share the admitted reservation ledger", async () => {
  const { DocumentBudget } = await import("./budget.js");
  const budget = new DocumentBudget({}, textContext.signal);
  const model = await openDocumentStyleModel(undefined, { ...textContext, budget });
  const write = vi.fn();
  await model.publish(
    { output: "-" },
    {
      ...textContext,
      budget: budget.lower({}, textContext.signal),
      stdout: { write },
      encoding: { order: "input", compression: "store" }
    }
  );
  expect(write).toHaveBeenCalledOnce();
});
