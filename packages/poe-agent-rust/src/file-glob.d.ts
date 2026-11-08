import fsPromises from "node:fs/promises";
export declare function globFiles(options: {
  pattern: string;
  cwd: string;
  fs?: Pick<typeof fsPromises, "stat" | "realpath" | "readdir">;
}): Promise<string[]>;
