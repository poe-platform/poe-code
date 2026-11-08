import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandHistory,
  CommandCompletion,
  ToastTimer,
  buildFileTree,
  fileLanguage,
  formatBytes,
  labelPath,
  resolveFilePath,
  uploadError,
  uploadToastLabel,
  type FileEntry
} from "./view.js";

describe("uploadToastLabel", () => {
  it("shows only the saved filename, including any collision suffix", () => {
    expect(uploadToastLabel(["/home/uploads/report-2.csv"])).toEqual({
      text: "report-2.csv",
      title: "report-2.csv"
    });
  });

  it("truncates the middle of long names and preserves the extension and collision suffix", () => {
    const name = `${"quarterly-report-".repeat(10)}-2.xlsx`;
    const label = uploadToastLabel([`/home/uploads/${name}`])!;
    expect(Array.from(label.text)).toHaveLength(24);
    expect(label.text).toContain("…");
    expect(label.text.startsWith("quarterly-")).toBe(true);
    expect(label.text.endsWith("-2.xlsx")).toBe(true);
    expect(label.title).toBe(name);
  });

  it("does not split Unicode characters or interpret HTML-like filenames", () => {
    const label = uploadToastLabel([`/home/uploads/${"😀".repeat(60)}.txt`])!;
    expect(Array.from(label.text)).toHaveLength(24);
    expect(label.text).not.toContain("\uFFFD");
    expect(label.text.endsWith(".txt")).toBe(true);
    expect(uploadToastLabel(["/home/uploads/<img>.txt"])?.text).toBe("<img>.txt");
  });

  it("keeps multiple uploads concise", () => {
    expect(uploadToastLabel(["/home/uploads/a", "/home/uploads/b", "/home/uploads/c"])).toEqual({
      text: "3 files uploaded",
      title: "3 files uploaded"
    });
    expect(uploadToastLabel([])).toBeNull();
  });
});

describe("ToastTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("dismisses once after five seconds", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = new ToastTimer(dismiss);
    vi.advanceTimersByTime(4999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    timer.resume();
    vi.advanceTimersByTime(5000);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("preserves the remaining time while hovered or focused", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = new ToastTimer(dismiss);
    vi.advanceTimersByTime(1000);
    timer.pause();
    vi.advanceTimersByTime(10000);
    timer.pause();
    expect(dismiss).not.toHaveBeenCalled();
    timer.resume();
    timer.resume();
    vi.advanceTimersByTime(3999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("cancels permanently when dismissed or replaced", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = new ToastTimer(dismiss);
    timer.cancel();
    timer.resume();
    vi.advanceTimersByTime(10000);
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KiB"],
    [1536, "1.5 KiB"],
    [2 * 1024 * 1024, "2 MiB"],
    [16 * 1024 * 1024, "16 MiB"],
    [1024 ** 4, "1 TiB"],
    [-1, "0 B"],
    [NaN, "0 B"],
    [Infinity, "0 B"]
  ])("formats %s as %s", (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

describe("file labels", () => {
  it("abbreviates only the home directory and its descendants", () => {
    expect(labelPath("/home")).toBe("~");
    expect(labelPath("/home/uploads/read me.txt")).toBe("~/uploads/read me.txt");
    expect(labelPath("/homework/file.txt")).toBe("/homework/file.txt");
    expect(labelPath("/")).toBe("/");
    expect(labelPath("/home/<img>.txt")).toBe("~/<img>.txt");
  });

  it.each([
    ["/home/app.TS", "TypeScript"],
    ["/home/script.mjs", "JavaScript"],
    ["/home/config.json", "JSON"],
    ["/home/readme.md", "Markdown"],
    ["/home/start.sh", "Shell"],
    ["/home/.bashrc", "Shell"],
    ["/home/config.yaml", "YAML"],
    ["/home/styles.css", "CSS"],
    ["/home/index.html", "HTML"],
    ["/home/data.csv", "CSV"],
    ["/home/hello.c", "C"],
    ["/home/hello.go", "Go"],
    ["/home/hello.java", "Java"],
    ["/home/hello.rb", "Ruby"],
    ["/home/hello.rs", "Rust"],
    ["/home/ts", "Plain text"],
    ["/home/__proto__", "Plain text"],
    ["/home/name.unknown", "Plain text"],
    ["/home/a.ts/README", "Plain text"]
  ])("labels %s", (path, language) => {
    expect(fileLanguage(path)).toBe(language);
  });
});

describe("resolveFilePath", () => {
  it("resolves relative names and normalizes paths without losing spaces", () => {
    expect(resolveFilePath("notes.txt", "/home")).toBe("/home/notes.txt");
    expect(resolveFilePath("~/notes.txt", "/home/examples")).toBe("/home/notes.txt");
    expect(resolveFilePath("../new file.txt", "/home/examples")).toBe("/home/new file.txt");
    expect(resolveFilePath("/home/a/../b//./c.txt", "/home")).toBe("/home/b/c.txt");
  });

  it.each(["", "   ", "/", "/etc/config", "../../escape.txt", "/home"])(
    "rejects invalid workspace file path %s",
    (path) => {
      expect(() => resolveFilePath(path, "/home")).toThrow();
    }
  );
});

describe("uploadError", () => {
  const limits = { maxFileBytes: 10, maxTotalBytes: 20 };

  it("accepts exact limits and empty files", () => {
    expect(
      uploadError(
        [
          { name: "a", size: 10 },
          { name: "empty", size: 0 }
        ],
        10,
        limits
      )
    ).toBeNull();
  });

  it("rejects an oversized file before reading it", () => {
    expect(uploadError([{ name: "<img>.txt", size: 11 }], 0, limits)).toContain("<img>.txt");
  });

  it("checks the entire batch against remaining workspace memory", () => {
    expect(
      uploadError(
        [
          { name: "a", size: 8 },
          { name: "b", size: 8 }
        ],
        5,
        limits
      )
    ).toContain("workspace");
  });
});

describe("CommandHistory", () => {
  it("navigates commands and restores the unsubmitted draft", () => {
    const history = new CommandHistory();
    history.record("ls");
    history.record("cat notes.txt");
    expect(history.previous("unfinished draft")).toBe("cat notes.txt");
    expect(history.previous("cat notes.txt")).toBe("ls");
    expect(history.previous("ls")).toBe("ls");
    expect(history.next("ls")).toBe("cat notes.txt");
    expect(history.next("cat notes.txt")).toBe("unfinished draft");
    expect(history.next("edited draft")).toBe("edited draft");
  });

  it("leaves input untouched without history", () => {
    const history = new CommandHistory();
    expect(history.previous("draft")).toBe("draft");
    expect(history.next("draft")).toBe("draft");
  });

  it("ignores blank commands and consecutive duplicates, preserving exact commands", () => {
    const history = new CommandHistory();
    history.record("echo 'hello  world'");
    history.record("echo 'hello  world'");
    history.record("  ");
    history.record("pwd");
    expect(history.previous("")).toBe("pwd");
    expect(history.previous("")).toBe("echo 'hello  world'");
    expect(history.next("")).toBe("pwd");
  });

  it("resets navigation after submission or cancellation", () => {
    const history = new CommandHistory();
    history.record("ls");
    history.previous("old draft");
    history.resetNavigation();
    expect(history.previous("new draft")).toBe("ls");
    expect(history.next("")).toBe("new draft");
    history.previous("another draft");
    history.record("pwd");
    expect(history.next("")).toBe("");
    expect(history.previous("")).toBe("pwd");
  });
});

describe("CommandCompletion", () => {
  it("cycles full replacements without re-querying the model", async () => {
    const completion = new CommandCompletion();
    const complete = vi.fn(async () => ["cat alpha.txt", "cat another.txt"]);
    expect(await completion.next("cat a", complete)).toEqual({ value: "cat alpha.txt", count: 2 });
    expect(await completion.next("cat alpha.txt", complete)).toEqual({
      value: "cat another.txt",
      count: 2
    });
    expect(await completion.next("cat another.txt", complete)).toEqual({
      value: "cat alpha.txt",
      count: 2
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a cycle for changed input", async () => {
    const completion = new CommandCompletion();
    const complete = vi.fn(async (input: string) => [input === "pw" ? "pwd" : "ls"]);
    await completion.next("pw", complete);
    expect(await completion.next("l", complete)).toEqual({ value: "ls", count: 1 });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("ignores results invalidated by typing, caret movement, blur, or a mutation", async () => {
    const completion = new CommandCompletion();
    let resolve!: (values: string[]) => void;
    const pending = completion.next(
      "pw",
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    completion.reset();
    resolve(["pwd"]);
    expect(await pending).toBeNull();
  });

  it("suppresses outdated failures instead of replacing a newer status", async () => {
    const completion = new CommandCompletion();
    let reject!: (error: Error) => void;
    const pending = completion.next(
      "pw",
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    completion.reset();
    reject(new Error("old completion failed"));
    await expect(pending).resolves.toBeNull();
  });

  it("lets the newest request win when responses arrive out of order", async () => {
    const completion = new CommandCompletion();
    let resolve!: (values: string[]) => void;
    const older = completion.next(
      "ca",
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    expect(await completion.next("pw", async () => ["pwd"])).toEqual({ value: "pwd", count: 1 });
    resolve(["cat"]);
    expect(await older).toBeNull();
  });

  it("clears cached paths after a filesystem mutation", async () => {
    const completion = new CommandCompletion();
    const complete = vi.fn(async () => ["cat old.txt"]);
    await completion.next("cat o", complete);
    completion.reset();
    complete.mockResolvedValue([]);
    expect(await completion.next("cat old.txt", complete)).toEqual({
      value: "cat old.txt",
      count: 0
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("surfaces failures from the current request", async () => {
    const completion = new CommandCompletion();
    await expect(
      completion.next("pw", async () => {
        throw new Error("unavailable");
      })
    ).rejects.toThrow("unavailable");
  });
});

describe("buildFileTree", () => {
  const entries: FileEntry[] = [
    { path: "/home/z.txt", name: "z.txt", kind: "file", size: 4 },
    { path: "/home/src/nested/app.ts", name: "app.ts", kind: "file", size: 5 },
    { path: "/home", name: "home", kind: "directory", size: 0 },
    { path: "/home/src", name: "src", kind: "directory", size: 0 },
    { path: "/home/src/nested", name: "nested", kind: "directory", size: 0 },
    { path: "/home/empty", name: "empty", kind: "directory", size: 0 },
    { path: "/home/a.txt", name: "a.txt", kind: "file", size: 1 }
  ];

  it("creates a recursive home-relative tree, directories before files", () => {
    const tree = buildFileTree(entries);
    expect(tree.map((node) => node.name)).toEqual(["empty", "src", "a.txt", "z.txt"]);
    expect(tree[1]?.children[0]?.children[0]?.path).toBe("/home/src/nested/app.ts");
    expect(tree[0]?.children).toEqual([]);
    expect(entries[0]?.path).toBe("/home/z.txt");
  });

  it("retains ancestors for a case-insensitive path search", () => {
    const tree = buildFileTree(entries, "  APP.TS  ");
    expect(tree.map((node) => node.path)).toEqual(["/home/src"]);
    expect(tree[0]?.children[0]?.children[0]?.name).toBe("app.ts");
    expect(buildFileTree(entries, "src/nested")[0]?.children[0]?.children).toHaveLength(1);
    expect(buildFileTree(entries, "missing")).toEqual([]);
  });

  it("ignores entries outside home and builds missing parent directories", () => {
    const tree = buildFileTree([
      { path: "/home/a/b.txt", name: "b.txt", kind: "file", size: 1 },
      { path: "/homework/c.txt", name: "c.txt", kind: "file", size: 1 }
    ]);
    expect(tree.map((node) => node.path)).toEqual(["/home/a"]);
    expect(tree[0]?.children[0]?.name).toBe("b.txt");
  });
});
