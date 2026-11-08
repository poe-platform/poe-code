export const wcVectors = [
  { name: "pipe two columns", args: ["-lw"], stdin: "one two\nthree\n", env: { LC_ALL: "C" } },
  { name: "C characters", args: ["-m"], stdin: "éabc\n", env: { LC_ALL: "C" } },
  { name: "POSIX characters", args: ["-m"], stdin: "éabc\n", env: { LC_ALL: "POSIX" } },
  { name: "UTF8 characters", args: ["-m"], stdin: "é😀\n", env: { LC_ALL: "en_US.UTF-8" } },
  { name: "UTF8 BOM", args: ["-m"], stdin: "\ufeffa\n", env: { LC_ALL: "en_US.UTF-8" } },
  { name: "all columns", args: ["-lwcm"], stdin: "héllo  world\nlast", env: { LC_ALL: "en_US.UTF-8" } },
  { name: "C overrides LANG", args: ["-m"], stdin: "é\n", env: { LC_ALL: "C", LANG: "en_US.UTF-8" } },
  { name: "CTYPE overrides LANG", args: ["-m"], stdin: "é\n", env: { LC_CTYPE: "C", LANG: "en_US.UTF-8" } },
  { name: "single file", args: ["-lwcm", "first"], stdin: "", env: { LC_ALL: "C" } },
  { name: "files total width", args: ["-lwcm", "first", "second"], stdin: "", env: { LC_ALL: "C" } },
  { name: "file single column", args: ["-l", "first", "second"], stdin: "", env: { LC_ALL: "C" } },
  { name: "file plus stream", args: ["-lc", "first", "-"], stdin: "x\n", env: { LC_ALL: "C" } },
];

export const realpathVectors = [
  ["--relative-to=.", "tree/file"], ["--relative-to", "tree", "tree/file"],
  ["--relative-to=tree", "other/file"], ["--relative-to=alias", "tree/file"],
  ["--relative-base=tree", "tree/file", "other/file"],
  ["--relative-to=tree", "--relative-base=.", "other/file"],
  ["--relative-to=other", "--relative-base=tree", "tree/file"],
  ["-m", "--relative-to=tree/missing", "other/missing/leaf"],
  ["-e", "--relative-to=tree", "tree/file"],
  ["-z", "--relative-to=.", "tree/file", "other/file"],
  ["--relative-to=tree", "tree"], ["--", "--relative-to=literal"],
];

export const files = { first: "a\n".repeat(5), second: "b\nc\n", "tree/file": "payload", "other/file": "other", "--relative-to=literal": "literal" };
