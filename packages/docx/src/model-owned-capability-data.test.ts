import { expect, it, vi } from "vitest";
import { Document, Image, InputTypeError, type DocumentModelContext } from "./index.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

function restore(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
  else Reflect.deleteProperty(Object.prototype, name);
}

it.each(["author", "timestamp", "metrics", "signal"])(
  "takes intrinsic %s defaults without consulting the object prototype",
  async (name) => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, name);
    const getter = vi.fn(() => {
      throw new Error("Ambient metadata must not be consulted");
    });
    Object.defineProperty(Object.prototype, name, { configurable: true, get: getter });
    try {
      const pending = Document();
      expect(pending).toBeInstanceOf(Promise);
      const document = await pending;
      expect(document.core_properties.author).toBe("");
      expect(getter).not.toHaveBeenCalled();
    } finally {
      restore(name, previous);
    }
  }
);

it("does not acquire a sink from the intrinsic object prototype", async () => {
  const { fs, volume } = publication(new Uint8Array());
  const document = await Document(undefined, {
    ...textContext,
    vfs: { capability: "memory", filesystem: fs }
  });
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "stage");
  const stage = vi.fn(async () => ({ async write() {}, async commit() {}, async abort() {} }));
  Object.defineProperty(Object.prototype, "stage", { configurable: true, value: stage });
  try {
    await expect(document.save({ path: "/out/denied", capability: "other" })).rejects.toMatchObject(
      { code: "unsupported-edit" }
    );
    expect(stage).not.toHaveBeenCalled();
    expect(volume.readdirSync("/out")).toEqual([]);
  } finally {
    restore("stage", previous);
  }
});

it.each(["image", "output"])(
  "requires owned %s path fields rather than ambient prototype fields",
  async (kind) => {
    const { fs, volume } = publication(new Uint8Array());
    const context: DocumentModelContext = {
      ...textContext,
      vfs: { capability: "memory", filesystem: fs },
      binaryResolver: {
        capability: "memory",
        async *open() {
          yield rasterPng();
        }
      }
    };
    const document = await Document(undefined, context);
    const path = Object.getOwnPropertyDescriptor(Object.prototype, "path"),
      capability = Object.getOwnPropertyDescriptor(Object.prototype, "capability");
    Object.defineProperty(Object.prototype, "path", { configurable: true, value: "/out/ambient" });
    Object.defineProperty(Object.prototype, "capability", { configurable: true, value: "memory" });
    try {
      const pending =
        kind === "image" ? Image.from_file({} as never, context) : document.save({} as never);
      expect(
        await pending.then(
          () => false,
          (error) => error instanceof InputTypeError
        )
      ).toBe(true);
      expect(volume.readdirSync("/out")).toEqual([]);
    } finally {
      restore("path", path);
      restore("capability", capability);
    }
  }
);

it.each(["input", "resolver"])("requires an explicitly owned %s open method", async (kind) => {
  const bytes = await textFixture("<w:p><w:r><w:t>Ambient input</w:t></w:r></w:p>");
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "open");
  const open = vi.fn(async function* () {
    yield bytes;
  });
  Object.defineProperty(Object.prototype, "open", { configurable: true, value: open });
  try {
    const pending =
      kind === "input"
        ? Document({ capability: "ungranted" } as never, textContext)
        : Document(undefined, {
            ...textContext,
            binaryResolver: { capability: "memory" }
          } as never);
    expect(
      await pending.then(
        () => false,
        (error) => error instanceof InputTypeError
      )
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
  } finally {
    restore("open", previous);
  }
});

it.each(["binaryResolver", "vfs"])(
  "does not inherit missing admitted %s authority",
  async (name) => {
    const document = await Document(undefined, textContext);
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, name);
    const getter = vi.fn(() => {
      throw new Error("Missing authority must not be discovered");
    });
    Object.defineProperty(Object.prototype, name, { configurable: true, get: getter });
    try {
      const path = { path: "/denied", capability: "ungranted" };
      const pending = name === "binaryResolver" ? Document(path, textContext) : document.save(path);
      expect(
        await pending.then(
          () => "accepted",
          (error) => error.code
        )
      ).toBe("unsupported-edit");
      expect(getter).not.toHaveBeenCalled();
    } finally {
      restore(name, previous);
    }
  }
);
