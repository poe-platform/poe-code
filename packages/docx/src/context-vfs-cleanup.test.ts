import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  Image,
  PackageView,
  openDocumentStyleModel,
  resolveDocumentModelContext,
  DocumentBudget,
  InputTypeError,
  type DocumentModelContext
} from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

const factories = ["document", "styles", "package", "image", "template"] as const;

it.each(["cancel", "missing-next"])(
  "closes an acquired iterator on %s before advancing",
  async (failure) => {
    const controller = new AbortController();
    const next = vi.fn(async () => ({ done: true as const, value: undefined }));
    const finish = vi.fn(async () => ({ done: true as const, value: undefined }));
    const vfs = {
      open: () => ({
        [Symbol.asyncIterator]() {
          if (failure === "cancel") controller.abort();
          return { next: failure === "cancel" ? next : undefined, return: finish };
        }
      })
    };
    const pending = Document(
      { path: "/source", capability: vfs } as never,
      {
        ...textContext,
        vfs,
        signal: controller.signal
      } as never
    );
    if (failure === "cancel") await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    else await expect(pending).rejects.toBeInstanceOf(InputTypeError);
    expect(next).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  }
);

it.each(factories.flatMap((factory) => ["object", "token"].map((mode) => ({ factory, mode }))))(
  "awaits owned iterator cleanup after $mode $factory source rejection",
  async ({ factory, mode }) => {
    const volume = Volume.fromJSON({ "/unowned": "retain", "/cleanup": "" });
    const failure = new Error("Source failed after opening");
    const cleanupFailure = new Error("Cleanup also failed");
    let release!: () => void, closing!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      closing = resolve;
    });
    const next = vi.fn(async () => {
      throw failure;
    });
    const finish = vi.fn(async () => {
      closing();
      await gate;
      volume.appendFileSync("/cleanup", "closed");
      throw cleanupFailure;
    });
    const open = vi.fn(() => ({ [Symbol.asyncIterator]: () => ({ next, return: finish }) }));
    const vfs = { open };
    const registered: (() => Promise<void>)[] = [];
    const context: DocumentModelContext = {
      ...textContext,
      ...(mode === "object" ? { vfs } : {}),
      binaryResolver: { capability: "owned", open },
      registerCleanup(cleanup) {
        registered.push(cleanup);
      }
    };
    const input = { path: "/source", capability: mode === "object" ? vfs : "owned" };
    const pending =
      factory === "document"
        ? Document(input, context)
        : factory === "styles"
          ? openDocumentStyleModel(input, context)
          : factory === "package"
            ? PackageView.open(input, context)
            : factory === "image"
              ? Image.from_file(input, context)
              : resolveDocumentModelContext(
                  { template: { kind: "vfs", path: input.path, capability: "owned" } },
                  context
                );
    let settled = false;
    const observed = pending.then(
      () => {
        settled = true;
        return undefined;
      },
      (error) => {
        settled = true;
        return error;
      }
    );
    // Failure settlement also wakes the assertion on the unfixed implementation.
    await Promise.race([started, observed]);
    try {
      expect(finish).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
    } finally {
      release();
    }
    expect(await observed).toBe(failure);
    await Promise.all(registered.flatMap((cleanup) => [cleanup(), cleanup()]));
    expect(finish).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(volume.readFileSync("/cleanup", "utf8")).toBe("closed");
    expect(volume.readFileSync("/unowned", "utf8")).toBe("retain");
  }
);

it.each(["object", "token"])(
  "settles %s cleanup when only the shared budget is cancelled",
  async (mode) => {
    const controller = new AbortController();
    const budget = new DocumentBudget({}, controller.signal);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finish = vi.fn(async () => ({ done: true as const, value: undefined }));
    const open = vi.fn((_path: string, options: { signal: AbortSignal }) => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true
            });
            entered();
          }),
        return: finish
      })
    }));
    const vfs = { open };
    const pending = Document(
      { path: "/source", capability: mode === "object" ? vfs : "owned" },
      {
        ...textContext,
        budget,
        vfs,
        binaryResolver: { capability: "owned", open }
      }
    );
    const observed = pending.catch((error) => error);
    await started;
    controller.abort();
    expect(await observed).toMatchObject({ code: "cancelled" });
    expect(finish).toHaveBeenCalledOnce();
  }
);
