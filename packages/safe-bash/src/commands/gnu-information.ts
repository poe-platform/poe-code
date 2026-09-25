import { writeBytes, type CommandContext, type CommandResult } from "../contracts/index.js";

interface Information {
  readonly usage: string;
  readonly description: string;
  readonly options: readonly string[];
  readonly stopAtOperand?: boolean;
  readonly versionOnly?: boolean;
}

// These describe the virtual implementations, not the complete GNU option set.
const information: Readonly<Record<string, Information>> = {
  cat: { usage: "[OPTION]... [FILE]...", description: "Concatenate input files.", options: ["-n, --number", "-b, --number-nonblank", "-s, --squeeze-blank", "-E, --show-ends", "-T, --show-tabs", "-v, --show-nonprinting", "-A, --show-all"], versionOnly: true },
  du: { usage: "[OPTION]... [FILE]...", description: "Report virtual file allocation.", options: ["-a, --all", "-s, --summarize", "-c, --total", "-h, --human-readable", "-B, --block-size=SIZE", "-b, --bytes", "--apparent-size", "-d, --max-depth=NUM", "-X, --exclude-from=FILE", "--exclude=PATTERN", "-t, --threshold=SIZE"], versionOnly: true },
  base32: { usage: "[OPTION]... [FILE]", description: "Encode or decode Base32 data.", options: ["-d, --decode", "-i, --ignore-garbage", "-w, --wrap=COLS"] },
  base64: { usage: "[OPTION]... [FILE]", description: "Encode or decode Base64 data.", options: ["-d, --decode", "-i, --ignore-garbage", "-w, --wrap=COLS"] },
  basename: { usage: "[OPTION]... NAME... [SUFFIX]", description: "Remove directory components and an optional suffix from names.", options: ["-a, --multiple", "-s, --suffix=SUFFIX", "-z, --zero"] },
  dirname: { usage: "[OPTION]... NAME...", description: "Print the directory component of each name.", options: ["-z, --zero"] },
  chmod: { usage: "[OPTION]... MODE FILE...", description: "Change virtual file permissions, subject to filesystem capabilities.", options: ["-R, --recursive", "-v, --verbose", "-c, --changes", "-f, --silent, --quiet", "--reference=FILE"] },
  cksum: { usage: "[OPTION]... [FILE]...", description: "Compute checksums of files or standard input.", options: ["-a, --algorithm=TYPE", "-b, --binary", "-z, --zero", "--tag", "--untagged", "--raw", "--base64"] },
  comm: { usage: "[OPTION]... FILE1 FILE2", description: "Compare sorted files in the C/POSIX byte locale.", options: ["-1", "-2", "-3", "--output-delimiter=STR", "--check-order", "--nocheck-order"] },
  cp: { usage: "[OPTION]... SOURCE... DEST", description: "Copy virtual files, subject to filesystem capabilities.", options: ["-a, --archive", "-r, -R, --recursive", "-f, --force", "-i, --interactive", "-n, --no-clobber", "-v, --verbose", "-t, --target-directory=DIR", "-T, --no-target-directory", "-S, --suffix=SUFFIX"] },
  cut: { usage: "[OPTION]... [FILE]...", description: "Select bytes, characters or fields from each input line.", options: ["-b, --bytes=LIST", "-c, --characters=LIST", "-f, --fields=LIST", "-d, --delimiter=CHAR", "-s, --only-delimited", "-z, --zero-terminated", "--output-delimiter=STR", "--complement"] },
  env: { usage: "[OPTION]... [NAME=VALUE]... [COMMAND [ARG]...]", description: "Print the environment or run a registered command with a modified environment.", options: ["-i, --ignore-environment", "-u, --unset=NAME", "-C, --chdir=DIR", "-S, --split-string=STR", "-0, --null"], stopAtOperand: true },
  expand: { usage: "[OPTION]... [FILE]...", description: "Convert tabs to spaces.", options: ["-i, --initial", "-t, --tabs=LIST"] },
  fold: { usage: "[OPTION]... [FILE]...", description: "Wrap input lines to a selected width.", options: ["-b, --bytes", "-s, --spaces", "-w, --width=COLS"] },
  head: { usage: "[OPTION]... [FILE]...", description: "Print the first ten lines by default, or a selected line/byte count.", options: ["-n, --lines=NUM", "-c, --bytes=NUM", "-q, --quiet, --silent", "-v, --verbose", "-z, --zero-terminated"] },
  tail: { usage: "[OPTION]... [FILE]...", description: "Print the last ten lines by default, or a selected line/byte count.", options: ["-n, --lines=NUM", "-c, --bytes=NUM", "-q, --quiet, --silent", "-v, --verbose", "-z, --zero-terminated"] },
  join: { usage: "[OPTION]... FILE1 FILE2", description: "Join sorted files on a common field in the C/POSIX byte locale.", options: ["-1=FIELD", "-2=FIELD", "-j=FIELD", "-t=CHAR", "-a=FILENUM", "-v=FILENUM", "-e=STR", "-o=FORMAT", "-i", "--check-order", "--nocheck-order"] },
  ln: { usage: "[OPTION]... TARGET... LINK_NAME", description: "Create virtual hard or symbolic links when supported by the filesystem.", options: ["-s, --symbolic", "-r, --relative", "-f, --force", "-i, --interactive", "-n, --no-dereference", "-v, --verbose", "-t, --target-directory=DIR", "-T, --no-target-directory", "-S, --suffix=SUFFIX"] },
  ls: { usage: "[OPTION]... [FILE]...", description: "List virtual directory entries.", options: ["-a, --all", "-A, --almost-all", "-l", "-1", "-d, --directory", "-F, --classify", "-r, --reverse", "-R, --recursive", "-L, --dereference", "-h, --human-readable"] },
  mkdir: { usage: "[OPTION]... DIRECTORY...", description: "Create virtual directories.", options: ["-p, --parents", "-m, --mode=MODE", "-v, --verbose"] },
  mktemp: { usage: "[OPTION]... [TEMPLATE]", description: "Create a temporary virtual file or directory.", options: ["-d, --directory", "-q, --quiet", "-u, --dry-run", "-p=DIR", "--tmpdir[=DIR]", "--suffix=SUFFIX"] },
  mv: { usage: "[OPTION]... SOURCE... DEST", description: "Move virtual files, subject to filesystem capabilities.", options: ["-f, --force", "-i, --interactive", "-n, --no-clobber", "-u, --update", "-v, --verbose", "-t, --target-directory=DIR", "-T, --no-target-directory", "-S, --suffix=SUFFIX"] },
  nl: { usage: "[OPTION]... [FILE]...", description: "Number input lines by section and numbering style.", options: ["-b, --body-numbering=STYLE", "-h, --header-numbering=STYLE", "-f, --footer-numbering=STYLE", "-v, --starting-line-number=NUM", "-i, --line-increment=NUM", "-s, --number-separator=STR", "-w, --number-width=NUM", "-n, --number-format=FORMAT", "-d, --section-delimiter=STR", "-l, --join-blank-lines=NUM", "-p, --no-renumber"] },
  od: { usage: "[OPTION]... [FILE]...", description: "Print input bytes in selected numeric formats.", options: ["-A, --address-radix=RADIX", "-j, --skip-bytes=NUM", "-N, --read-bytes=NUM", "-t, --format=TYPE, --type=TYPE", "-w, --width=NUM", "--endian=ORDER", "-v, --output-duplicates"] },
  paste: { usage: "[OPTION]... [FILE]...", description: "Merge corresponding or serial input lines.", options: ["-s, --serial", "-d, --delimiters=LIST", "-z, --zero-terminated"] },
  readlink: { usage: "[OPTION]... FILE...", description: "Print symbolic link targets or canonical virtual paths.", options: ["-f, --canonicalize", "-e, --canonicalize-existing", "-m, --canonicalize-missing", "-n, --no-newline", "-z, --zero"] },
  realpath: { usage: "[OPTION]... FILE...", description: "Print canonical virtual paths.", options: ["-e, --canonicalize-existing", "-m, --canonicalize-missing", "-s, --strip, --no-symlinks", "-z, --zero"] },
  rm: { usage: "[OPTION]... FILE...", description: "Remove virtual files and directories.", options: ["-r, -R, --recursive", "-f, --force", "-d, --dir", "-v, --verbose", "-i", "-I"] },
  rmdir: { usage: "[OPTION]... DIRECTORY...", description: "Remove empty virtual directories.", options: ["-p, --parents", "-v, --verbose", "--ignore-fail-on-non-empty"] },
  seq: { usage: "[OPTION]... [FIRST [INCREMENT]] LAST", description: "Print a numeric sequence.", options: ["-s, --separator=STR", "-f, --format=FORMAT", "-w, --equal-width"] },
  sort: { usage: "[OPTION]... [FILE]...", description: "Sort input records using the supported byte-oriented ordering modes.", options: ["-n, --numeric-sort", "-g, --general-numeric-sort", "-h, --human-numeric-sort", "-V, --version-sort", "-r, --reverse", "-f, --ignore-case", "-u, --unique", "-s, --stable", "-m, --merge", "-k, --key=KEY", "-t, --field-separator=CHAR", "-o, --output=FILE", "--sort=MODE", "-z, --zero-terminated"] },
  split: { usage: "[OPTION]... [FILE [PREFIX]]", description: "Split input into virtual output files.", options: ["-l, --lines=NUM", "-b, --bytes=SIZE", "-C, --line-bytes=SIZE", "-a, --suffix-length=NUM", "--additional-suffix=SUFFIX"] },
  stat: { usage: "[OPTION]... FILE...", description: "Display virtual file metadata supplied by the filesystem.", options: ["-L, --dereference", "-c, --format=FORMAT", "--printf=FORMAT", "-t, --terse"] },
  tac: { usage: "[OPTION]... [FILE]...", description: "Print input records in reverse order.", options: ["-b, --before", "-r, --regex", "-s, --separator=STR"] },
  tee: { usage: "[OPTION]... [FILE]...", description: "Copy standard input to standard output and virtual files.", options: ["-a, --append", "-i, --ignore-interrupts", "--output-error=MODE"] },
  touch: { usage: "[OPTION]... FILE...", description: "Update virtual file timestamps, creating missing files by default.", options: ["-a", "-m", "-c, --no-create", "-h, --no-dereference", "-r, --reference=FILE", "-d, --date=STR", "-t=STAMP"] },
  tr: { usage: "[OPTION]... STRING1 [STRING2]", description: "Translate, delete or squeeze input bytes.", options: ["-d, --delete", "-s, --squeeze-repeats", "-c, -C, --complement", "-t, --truncate-set1"] },
  unexpand: { usage: "[OPTION]... [FILE]...", description: "Convert spaces to tabs.", options: ["-a, --all", "-t, --tabs=LIST", "--first-only"] },
  uniq: { usage: "[OPTION]... [INPUT [OUTPUT]]", description: "Filter adjacent repeated input records.", options: ["-c, --count", "-d, --repeated", "-u, --unique", "-i, --ignore-case", "-f, --skip-fields=NUM", "-s, --skip-chars=NUM", "-w, --check-chars=NUM", "-z, --zero-terminated"] },
  wc: { usage: "[OPTION]... [FILE]...", description: "Count input lines, words, bytes, characters or display width.", options: ["-l, --lines", "-w, --words", "-c, --bytes", "-m, --chars", "-L, --max-line-length"] },
  pwd: { usage: "[OPTION]...", description: "Print the full filename of the current working directory.", options: ["-L, --logical", "-P, --physical"] },
  true: { usage: "[ignored command line arguments]", description: "Exit with a status code indicating success.", options: [] },
  false: { usage: "[ignored command line arguments]", description: "Exit with a status code indicating failure.", options: [] },
  echo: { usage: "[SHORT-OPTION]... [STRING]...", description: "Echo the STRING(s) to standard output.", options: ["-n", "-e", "-E"] },
  "[": { usage: "EXPRESSION ]", description: "Evaluate conditional expression.", options: [] },
};

const checksumInformation: Information = {
  usage: "[OPTION]... [FILE]...", description: "Compute or verify file digests.",
  options: ["-b, --binary", "-c, --check", "-t, --text", "-z, --zero", "--tag", "--quiet", "--status", "--strict", "--warn", "--ignore-missing"],
};

export function gnuInformation(name: string, context: CommandContext): Promise<CommandResult | undefined> | undefined {
  if (!context.args.includes("--help") && !context.args.includes("--version")) return undefined;
  return gnuInformationSlow(name, context);
}

async function gnuInformationSlow(name: string, context: CommandContext): Promise<CommandResult | undefined> {
  if ((name === "true" || name === "false" || name === "echo" || name === "[") && (context.args.length !== 1 || !(context as { externalInvocation?: boolean }).externalInvocation)) return undefined;
  const info = information[name] ?? (["md5sum", "sha1sum", "sha224sum", "sha256sum", "sha384sum", "sha512sum"].includes(name) ? checksumInformation : undefined);
  if (!info) return undefined;
  const flags = new Map<string, "none" | "required" | "optional">();
  for (const option of info.options) {
    const takesValue = option.includes("[=") ? "optional" : option.includes("=") ? "required" : "none";
    for (const spelling of option.split(", ")) flags.set(spelling.split("=")[0]!.split("[")[0]!, takesValue);
  }
  for (let index = 0; index < context.args.length; index++) {
    const arg = context.args[index]!;
    if (arg === "--") break;
    if (arg === "--help" || arg === "--version") {
      if (arg === "--help" && info.versionOnly) return undefined;
      const text = arg === "--version"
        ? `${name} (safe-bash virtual implementation)\n`
        : `Usage: ${name} ${info.usage}\n${info.description}\n\nCommon supported options (additional behavior is documented in the package):\n${info.options.map(option => `  ${option.split(", ").map(spelling => spelling.startsWith("--") ? spelling : spelling.replace("=", " ")).join(", ")}`).join("\n")}\n  --help     display this help and exit\n  --version  display implementation information and exit\n\nThis is the safe-bash virtual implementation; filesystem operations require backend capabilities.\n`;
      await writeBytes(context.stdout, new TextEncoder().encode(text), context.signal);
      return { exitCode: 0 };
    }
    if (!arg.startsWith("-") || arg === "-") {
      if (info.stopAtOperand) break;
      continue;
    }
    if (arg.startsWith("--")) {
      const equal = arg.indexOf("=");
      const spelling = equal < 0 ? arg : arg.slice(0, equal);
      if (!flags.has(spelling)) return undefined;
      if (flags.get(spelling) === "required" && equal < 0) index++;
      else if (flags.get(spelling) === "none" && equal >= 0) return undefined;
    } else {
      for (let offset = 1; offset < arg.length; offset++) {
        const spelling = `-${arg[offset]}`;
        if (!flags.has(spelling)) return undefined;
        if (flags.get(spelling) === "required") {
          if (offset + 1 === arg.length) index++;
          break;
        }
      }
    }
  }
  return undefined;
}
