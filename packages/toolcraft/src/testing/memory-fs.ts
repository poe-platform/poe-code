import type { HandlerFs } from "../index.js";

export type FsChange = {
  op: "writeFile" | "rename" | "unlink";
  path: string;
  to?: string;
};

export interface MemoryFs extends HandlerFs {
  snapshot(): Record<string, string>;
  changes(): FsChange[];
}

const writeModes = new Map([
  ...["r", "rs", "sr"].map((flag) => [flag, "read"] as const),
  ...["r+", "rs+", "sr+"].map((flag) => [flag, "update"] as const),
  ...["w", "w+", "wx", "xw", "wx+", "xw+"].map((flag) => [flag, "replace"] as const),
  ...["a", "a+", "ax", "xa", "ax+", "xa+", "as", "sa", "as+", "sa+"].map((flag) => [flag, "append"] as const)
]);

function missingFileError(
  syscall: string,
  path: string,
  dest?: string
): NodeJS.ErrnoException & { dest?: string } {
  const target = dest === undefined ? `'${path}'` : `'${path}' -> '${dest}'`;
  const error = new Error(
    `ENOENT: no such file or directory, ${syscall} ${target}`
  ) as NodeJS.ErrnoException & { dest?: string };
  error.code = "ENOENT";
  error.errno = -2;
  error.path = path;
  error.syscall = syscall;
  if (dest !== undefined) {
    error.dest = dest;
  }
  return error;
}

export function createMemoryFs(files: Record<string, string> = {}): MemoryFs {
  const contents = new Map(
    Object.entries(files).map(([path, value]) => [path, Buffer.from(value, "utf8")])
  );
  const changeLog: FsChange[] = [];

  return {
    async readFile(path, encoding = "utf8") {
      const value = contents.get(path);
      if (value === undefined) {
        throw missingFileError("open", path);
      }
      return value.toString(encoding);
    },
    async writeFile(path, value, options) {
      const bytes = Buffer.from(value, options?.encoding ?? "utf8");
      const flag = options?.flag || "w";
      const mode = writeModes.get(flag);
      if (mode === undefined) {
        throw Object.assign(new TypeError(`The argument 'flags' is invalid. Received '${flag}'`), {
          code: "ERR_INVALID_ARG_VALUE"
        });
      }
      const previous = contents.get(path);
      if (flag.includes("x") && previous !== undefined) {
        throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
          code: "EEXIST",
          errno: -17,
          syscall: "open",
          path
        });
      }
      if ((mode === "read" || mode === "update") && previous === undefined) {
        throw missingFileError("open", path);
      }
      if (mode === "read" && bytes.length > 0) {
        throw Object.assign(new Error("EBADF: bad file descriptor, write"), {
          code: "EBADF",
          errno: -9,
          syscall: "write"
        });
      }
      if (mode === "append" && previous !== undefined) {
        contents.set(path, Buffer.concat([previous, bytes]));
      } else if (mode === "update" && previous !== undefined) {
        contents.set(path, Buffer.concat([bytes, previous.subarray(bytes.length)]));
      } else if (mode !== "read") {
        contents.set(path, bytes);
      }
      changeLog.push({ op: "writeFile", path });
    },
    async exists(path) {
      return contents.has(path);
    },
    async lstat(path) {
      if (!contents.has(path)) {
        throw missingFileError("lstat", path);
      }
      return { isSymbolicLink: () => false };
    },
    async rename(fromPath, toPath) {
      const value = contents.get(fromPath);
      if (value === undefined) {
        throw missingFileError("rename", fromPath, toPath);
      }
      if (fromPath !== toPath) {
        contents.set(toPath, value);
        contents.delete(fromPath);
      }
      changeLog.push({ op: "rename", path: fromPath, to: toPath });
    },
    async unlink(path) {
      if (!contents.delete(path)) {
        throw missingFileError("unlink", path);
      }
      changeLog.push({ op: "unlink", path });
    },
    snapshot() {
      return Object.fromEntries(
        Array.from(contents, ([path, value]) => [path, value.toString("utf8")])
      );
    },
    changes() {
      return changeLog.map((change) => ({ ...change }));
    }
  };
}
