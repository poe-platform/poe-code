import { expect, it, vi } from "vitest";
import { Document, InputTypeError, CancellationError, openDocumentStyleModel } from "./index.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { textContext } from "../tests/fixtures/text.js";

it.each(["document", "part", "package", "styles"])(
  "saves %s through an explicit VFS capability and preserves existing outputs",
  async (kind) => {
    const { fs, volume } = publication(new Uint8Array());
    const context = { ...textContext, vfs: { capability: "memory", filesystem: fs } };
    const document = await Document(undefined, context);
    document.add_paragraph("Owned content");
    const target =
      kind === "document"
        ? document
        : kind === "part"
          ? document.part
          : kind === "package"
            ? document.part.package
            : await openDocumentStyleModel(undefined, context);
    const output = { path: "/out/new.docx", capability: "memory" };
    const pending = target.save(output);
    expect(pending).toBeInstanceOf(Promise);
    output.path = "/out/later.docx";
    await pending;
    expect(volume.existsSync("/out/later.docx")).toBe(false);
    const loaded = await Document(
      new Uint8Array(volume.readFileSync("/out/new.docx") as Uint8Array)
    );
    if (kind !== "styles") expect(loaded.paragraphs.at(-1)!.text).toBe("Owned content");
    const previous = volume.readFileSync("/out/new.docx");
    await expect(
      target.save({ path: "/out/new.docx", capability: "memory" })
    ).rejects.toMatchObject({ code: "conflict" });
    expect(volume.readFileSync("/out/new.docx")).toEqual(previous);
    await expect(
      target.save({ path: "/out/denied.docx", capability: "other" })
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(volume.readdirSync("/out")).toEqual(["new.docx"]);
  }
);

it("captures a byte sink method before asynchronous serialization", async () => {
  const document = await Document();
  const write = vi.fn(async () => {}),
    later = vi.fn(async () => {});
  const sink = { write };
  const pending = document.save(sink);
  sink.write = later;
  await pending;
  expect(write).toHaveBeenCalledOnce();
  expect(later).not.toHaveBeenCalled();
});

it("rejects sink accessors asynchronously without executing them", async () => {
  const document = await Document();
  const getter = vi.fn(() => async () => {});
  const sink = Object.defineProperty({}, "write", { get: getter });
  const pending = document.save(sink as never);
  expect(pending).toBeInstanceOf(Promise);
  await expect(pending).rejects.toBeInstanceOf(InputTypeError);
  expect(getter).not.toHaveBeenCalled();
});

it("does not stage a cancelled VFS save", async () => {
  const { fs, volume } = publication(new Uint8Array());
  const stage = vi.spyOn(fs, "createStagedFile");
  const controller = new AbortController();
  const document = await Document(undefined, {
    ...textContext,
    signal: controller.signal,
    vfs: { capability: "memory", filesystem: fs }
  });
  controller.abort();
  await expect(
    document.save({ path: "/out/new.docx", capability: "memory" })
  ).rejects.toBeInstanceOf(CancellationError);
  expect(stage).not.toHaveBeenCalled();
  expect(volume.readdirSync("/out")).toEqual([]);
});

it.each(["cancel", "model mutation", "conditional conflict", "sink failure"])(
  "cleans its VFS stage after %s without publishing",
  async (kind) => {
    const { fs, volume } = publication(new Uint8Array());
    const controller = new AbortController();
    const document = await Document(undefined, {
      ...textContext,
      signal: controller.signal,
      vfs: { capability: "memory", filesystem: fs }
    });
    const create = fs.createStagedFile!.bind(fs);
    const publish = vi.spyOn(fs, "publishStagedFile");
    const cleanup = vi.spyOn(fs, "removeStagedFile");
    fs.createStagedFile = async (...args) => {
      const stage = await create(...args);
      if (kind === "cancel") controller.abort();
      if (kind === "model mutation") document.add_paragraph("Later content");
      return stage;
    };
    if (kind === "conditional conflict" || kind === "sink failure")
      publish.mockRejectedValue(
        Object.assign(new Error("Explicit adapter refusal"), {
          code: kind === "conditional conflict" ? "EAGAIN" : "EIO"
        })
      );
    const pending = document.save({ path: "/out/new.docx", capability: "memory" });
    await expect(pending).rejects.toMatchObject({
      code: kind === "cancel" ? "cancelled" : kind === "sink failure" ? "sink-failure" : "conflict",
      published: []
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(volume.readdirSync("/out")).toEqual([]);
    if (kind === "cancel" || kind === "model mutation") expect(publish).not.toHaveBeenCalled();
    if (kind !== "cancel") expect(document.add_paragraph("Recovered").text).toBe("Recovered");
  }
);

it("captures VFS authority at factory admission and refuses malformed capability accessors", async () => {
  const { fs, volume } = publication(new Uint8Array());
  const vfs = { capability: "memory", filesystem: fs };
  const document = await Document(undefined, { ...textContext, vfs });
  vfs.capability = "later";
  await document.save({ path: "/out/new.docx", capability: "memory" });
  expect(volume.existsSync("/out/new.docx")).toBe(true);
  const getter = vi.fn(() => fs);
  await expect(
    Document(undefined, {
      vfs: Object.defineProperty({ capability: "memory" }, "filesystem", { get: getter })
    } as never)
  ).rejects.toBeInstanceOf(InputTypeError);
  expect(getter).not.toHaveBeenCalled();
});

it("stages and commits a byte sink only after successful bounded serialization", async () => {
  const volume = publication(new Uint8Array()).volume;
  const document = await Document(undefined, textContext);
  document.add_paragraph("Staged content");
  let buffered = new Uint8Array();
  const write = vi.fn(async (bytes: Uint8Array) => {
    buffered = new Uint8Array(bytes);
  });
  const commit = vi.fn(async () => {
    volume.writeFileSync("/out/committed", buffered);
  });
  const abort = vi.fn(async () => {
    buffered = new Uint8Array();
  });
  const stage = vi.fn(async () => ({ write, commit, abort }));
  const pending = document.save({ stage });
  expect(pending).toBeInstanceOf(Promise);
  await pending;
  expect(stage).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
  expect(
    (
      await Document(new Uint8Array(volume.readFileSync("/out/committed") as Uint8Array))
    ).paragraphs.at(-1)!.text
  ).toBe("Staged content");
});

it.each(["write", "commit", "cancellation"])(
  "aborts an acquired byte sink stage after %s failure",
  async (failure) => {
    const controller = new AbortController();
    const document = await Document(undefined, { ...textContext, signal: controller.signal });
    const write = vi.fn(async () => {
      if (failure === "write") throw new Error("write refused");
      if (failure === "cancellation") controller.abort();
    });
    const commit = vi.fn(async () => {
      if (failure === "commit") throw new Error("commit refused");
    });
    const abort = vi.fn(async () => {});
    await expect(
      document.save({
        async stage() {
          return { write, commit, abort };
        }
      })
    ).rejects.toMatchObject({ code: failure === "cancellation" ? "cancelled" : "sink-failure" });
    expect(abort).toHaveBeenCalledOnce();
    if (failure !== "commit") expect(commit).not.toHaveBeenCalled();
    if (failure !== "cancellation")
      expect(document.add_paragraph("Recovered").text).toBe("Recovered");
  }
);

it("refuses stale serialization before acquiring a staged byte sink", async () => {
  const document = await Document(undefined, textContext);
  const stage = vi.fn(async () => ({ async write() {}, async commit() {}, async abort() {} }));
  const pending = document.save({ stage });
  document.add_paragraph("Later content");
  await expect(pending).rejects.toMatchObject({ code: "conflict" });
  expect(stage).not.toHaveBeenCalled();
});

it("owns staged method receivers and completes a successful commit despite late cancellation", async () => {
  const controller = new AbortController();
  const document = await Document(undefined, { ...textContext, signal: controller.signal });
  const acquired = {
    async write() {
      expect(this).toBe(acquired);
    },
    async commit() {
      expect(this).toBe(acquired);
      controller.abort();
    },
    async abort() {
      throw new Error("Successful commit must not be aborted");
    }
  };
  const sink = {
    async stage() {
      expect(this).toBe(sink);
      return acquired;
    }
  };
  await expect(document.save(sink)).resolves.toBeUndefined();
});

it.each(["part", "package"])(
  "validates malformed %s save arguments before spending publication work",
  async (kind) => {
    const document = await Document(undefined, textContext);
    const budget = document.store.context.budget;
    const target = kind === "part" ? document.part : document.part.package;
    budget.charge("work", budget.limits.work - budget.usage.work);
    const pending = target.save(null as never);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBeInstanceOf(InputTypeError);
  }
);
