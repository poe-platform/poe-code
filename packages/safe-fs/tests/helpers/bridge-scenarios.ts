export interface BridgeSubject {
  access(path: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir(path: string): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  readlink(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<{ mode: number; size: number; isFile(): boolean }>;
  symlink(target: string, path: string): Promise<void>;
  truncate(path: string, length: number): Promise<void>;
  utimes(path: string, atime: number, mtime: number): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
}

export async function exerciseBridge(bridge: BridgeSubject): Promise<string[]> {
  const operations: string[] = [];
  function check(condition: boolean): void {
    if (!condition) throw new Error("bridge operation contract failed");
  }
  await bridge.mkdir("work"); operations.push("mkdir");
  await bridge.writeFile("work/file", "one"); operations.push("writeFile");
  await bridge.appendFile("work/file", " two"); operations.push("appendFile");
  check(await bridge.readFile("work/file", "utf8") === "one two"); operations.push("readFile");
  await bridge.access("work/file"); operations.push("access");
  await bridge.chmod("work/file", 0o640); operations.push("chmod");
  await bridge.utimes("work/file", 1, 2); operations.push("utimes");
  await bridge.truncate("work/file", 3); operations.push("truncate");
  await bridge.copyFile("work/file", "work/copy"); operations.push("copyFile");
  await bridge.cp("work", "tree", { recursive: true }); operations.push("cp");
  await bridge.link("work/file", "work/hard"); operations.push("link");
  await bridge.symlink("file", "work/soft"); operations.push("symlink");
  check(await bridge.readlink("work/soft") === "file"); operations.push("readlink");
  check((await bridge.realpath("work/soft")).endsWith("/work/file")); operations.push("realpath");
  check((await bridge.lstat("work/soft")).isSymbolicLink()); operations.push("lstat");
  const stat = await bridge.stat("work/file");
  check(stat.isFile() && stat.size === 3 && (stat.mode & 0o777) === 0o640); operations.push("stat");
  check((await bridge.readdir("work")).includes("file")); operations.push("readdir");
  await bridge.rename("work/copy", "work/renamed"); operations.push("rename");
  await bridge.rm("work/renamed"); operations.push("rm");
  const temporary = await bridge.mkdtemp("temporary-");
  check(temporary.startsWith("temporary-") && temporary.length === "temporary-".length + 6);
  operations.push("mkdtemp");
  await bridge.rmdir(temporary); operations.push("rmdir");
  return operations;
}
