import { writeBytes, type CommandContext, type CommandResult } from "safe-bash-contracts";

type PackedInfo = readonly [desc: string, opts: string, usage?: string, flags?: number];
const information: Readonly<Record<string, PackedInfo>> = {"cat":["Concatenate input files.","-n, --number|-b, --number-nonblank|-s, --squeeze-blank|-E, --show-ends|-T, --show-tabs|-v, --show-nonprinting|-A, --show-all","",4],"du":["Report virtual file allocation.","-a, --all|-s, --summarize|-c, --total|-h, --human-readable|-B, --block-size=SIZE|-b, --bytes|--apparent-size|-d, --max-depth=NUM|-X, --exclude-from=FILE|--exclude=PATTERN|-t, --threshold=SIZE","",4],"base32":["Encode or decode Base32 data.","-d, --decode|-i, --ignore-garbage|-w, --wrap=COLS","[OPTION]... [FILE]",0],"base64":["Encode or decode Base64 data.","-d, --decode|-i, --ignore-garbage|-w, --wrap=COLS","[OPTION]... [FILE]",0],"basename":["Remove directory components and an optional suffix from names.","-a, --multiple|-s, --suffix=SUFFIX|-z, --zero","[OPTION]... NAME... [SUFFIX]",1],"dirname":["Print the directory component of each name.","-z, --zero","[OPTION]... NAME...",2],"chmod":["Change virtual file permissions, subject to filesystem capabilities.","-R, --recursive|-v, --verbose|-c, --changes|-f, --silent, --quiet|--reference=FILE","[OPTION]... MODE FILE...",0],"cksum":["Compute checksums of files or standard input.","-a, --algorithm=TYPE|-b, --binary|-z, --zero|--tag|--untagged|--raw|--base64"],"comm":["Compare sorted files in the C/POSIX byte locale.","-1|-2|-3|--output-delimiter=STR|--check-order|--nocheck-order","[OPTION]... FILE1 FILE2",0],"cp":["Copy virtual files, subject to filesystem capabilities.","-a, --archive|-r, -R, --recursive|-f, --force|-i, --interactive|-n, --no-clobber|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX","[OPTION]... SOURCE... DEST",0],"cut":["Select bytes, characters or fields from each input line.","-b, --bytes=LIST|-c, --characters=LIST|-f, --fields=LIST|-d, --delimiter=CHAR|-s, --only-delimited|-z, --zero-terminated|--output-delimiter=STR|--complement"],"env":["Print the environment or run a registered command with a modified environment.","-i, --ignore-environment|-u, --unset=NAME|-C, --chdir=DIR|-S, --split-string=STR|-0, --null","[OPTION]... [NAME=VALUE]... [COMMAND [ARG]...]",1],"expand":["Convert tabs to spaces.","-i, --initial|-t, --tabs=LIST"],"fold":["Wrap input lines to a selected width.","-b, --bytes|-s, --spaces|-w, --width=COLS"],"head":["Print the first ten lines by default, or a selected line/byte count.","-n, --lines=NUM|-c, --bytes=NUM|-q, --quiet, --silent|-v, --verbose|-z, --zero-terminated"],"tail":["Print the last ten lines by default, or a selected line/byte count.","-n, --lines=NUM|-c, --bytes=NUM|-q, --quiet, --silent|-v, --verbose|-z, --zero-terminated"],"join":["Join sorted files on a common field in the C/POSIX byte locale.","-1=FIELD|-2=FIELD|-j=FIELD|-t=CHAR|-a=FILENUM|-v=FILENUM|-e=STR|-o=FORMAT|-i|--check-order|--nocheck-order","[OPTION]... FILE1 FILE2",0],"ln":["Create virtual hard or symbolic links when supported by the filesystem.","-s, --symbolic|-r, --relative|-f, --force|-i, --interactive|-n, --no-dereference|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX","[OPTION]... TARGET... LINK_NAME",0],"ls":["List virtual directory entries.","-a, --all|-A, --almost-all|-l|-1|-d, --directory|-F, --classify|-r, --reverse|-R, --recursive|-L, --dereference|-h, --human-readable"],"mkdir":["Create virtual directories.","-p, --parents|-m, --mode=MODE|-v, --verbose","[OPTION]... DIRECTORY...",0],"mktemp":["Create a temporary virtual file or directory.","-d, --directory|-q, --quiet|-u, --dry-run|-p=DIR|--tmpdir[=DIR]|--suffix=SUFFIX","[OPTION]... [TEMPLATE]",0],"mv":["Move virtual files, subject to filesystem capabilities.","-f, --force|-i, --interactive|-n, --no-clobber|-u, --update|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX","[OPTION]... SOURCE... DEST",0],"nl":["Number input lines by section and numbering style.","-b, --body-numbering=STYLE|-h, --header-numbering=STYLE|-f, --footer-numbering=STYLE|-v, --starting-line-number=NUM|-i, --line-increment=NUM|-s, --number-separator=STR|-w, --number-width=NUM|-n, --number-format=FORMAT|-d, --section-delimiter=STR|-l, --join-blank-lines=NUM|-p, --no-renumber"],"od":["Print input bytes in selected numeric formats.","-A, --address-radix=RADIX|-j, --skip-bytes=NUM|-N, --read-bytes=NUM|-t, --format=TYPE, --type=TYPE|-w, --width=NUM|--endian=ORDER|-v, --output-duplicates"],"paste":["Merge corresponding or serial input lines.","-s, --serial|-d, --delimiters=LIST|-z, --zero-terminated"],"readlink":["Print symbolic link targets or canonical virtual paths.","-f, --canonicalize|-e, --canonicalize-existing|-m, --canonicalize-missing|-n, --no-newline|-z, --zero","[OPTION]... FILE...",0],"realpath":["Print canonical virtual paths.","-e, --canonicalize-existing|-m, --canonicalize-missing|-s, --strip, --no-symlinks|-z, --zero","[OPTION]... FILE...",0],"rm":["Remove virtual files and directories.","-r, -R, --recursive|-f, --force|-d, --dir|-v, --verbose|-i|-I","[OPTION]... FILE...",0],"rmdir":["Remove empty virtual directories.","-p, --parents|-v, --verbose|--ignore-fail-on-non-empty","[OPTION]... DIRECTORY...",0],"seq":["Print a numeric sequence.","-s, --separator=STR|-f, --format=FORMAT|-w, --equal-width","[OPTION]... [FIRST [INCREMENT]] LAST",0],"sort":["Sort input records using the supported byte-oriented ordering modes.","-n, --numeric-sort|-g, --general-numeric-sort|-h, --human-numeric-sort|-V, --version-sort|-r, --reverse|-f, --ignore-case|-u, --unique|-s, --stable|-m, --merge|-k, --key=KEY|-t, --field-separator=CHAR|-o, --output=FILE|--sort=MODE|-z, --zero-terminated|-c, --check|-C, --check=quiet|-S, --buffer-size=SIZE|--batch-size=NUM|--max-input-bytes=NUM|--max-records=NUM"],"split":["Split input into virtual output files.","-l, --lines=NUM|-b, --bytes=SIZE|-C, --line-bytes=SIZE|-a, --suffix-length=NUM|--additional-suffix=SUFFIX","[OPTION]... [FILE [PREFIX]]",0],"stat":["Display virtual file metadata supplied by the filesystem.","-L, --dereference|-c, --format=FORMAT|--printf=FORMAT|-t, --terse","[OPTION]... FILE...",0],"tac":["Print input records in reverse order.","-b, --before|-r, --regex|-s, --separator=STR"],"tee":["Copy standard input to standard output and virtual files.","-a, --append|-i, --ignore-interrupts|--output-error=MODE"],"touch":["Update virtual file timestamps, creating missing files by default.","-a|-m|-c, --no-create|-h, --no-dereference|-r, --reference=FILE|-d, --date=STR|-t=STAMP","[OPTION]... FILE...",0],"tr":["Translate, delete or squeeze input bytes.","-d, --delete|-s, --squeeze-repeats|-c, -C, --complement|-t, --truncate-set1","[OPTION]... STRING1 [STRING2]",0],"unexpand":["Convert spaces to tabs.","-a, --all|-t, --tabs=LIST|--first-only"],"uniq":["Filter adjacent repeated input records.","-c, --count|-d, --repeated|-u, --unique|-i, --ignore-case|-f, --skip-fields=NUM|-s, --skip-chars=NUM|-w, --check-chars=NUM|-z, --zero-terminated","[OPTION]... [INPUT [OUTPUT]]",0],"wc":["Count input lines, words, bytes, characters or display width.","-l, --lines|-w, --words|-c, --bytes|-m, --chars|-L, --max-line-length"],"pwd":["Print the full filename of the current working directory.","-L, --logical|-P, --physical","[OPTION]...",2],"true":["Exit with a status code indicating success.","","[ignored command line arguments]",0],"false":["Exit with a status code indicating failure.","","[ignored command line arguments]",8],"echo":["Echo the STRING(s) to standard output.","-n|-e|-E","[SHORT-OPTION]... [STRING]...",0],"[":["Evaluate conditional expression.","","EXPRESSION ]",0]};
const checksumInfo: PackedInfo = ["Compute or verify file digests.", "-b, --binary|-c, --check|-t, --text|-z, --zero|--tag|--quiet|--status|--strict|--warn|--ignore-missing"];
const sharedEncoder = new TextEncoder();

export function gnuInformationSync(name: string, args: readonly string[], externalInvocation = false, posixlyCorrect = false): string | undefined {
  if (!args.includes("--help") && !args.includes("--version")) return undefined;
  if ((name === "true" || name === "false" || name === "echo" || name === "[" || name === "pwd") && (args.length !== 1 || !externalInvocation)) return undefined;
  const raw = information[name] ?? (["md5sum", "sha1sum", "sha224sum", "sha256sum", "sha384sum", "sha512sum"].includes(name) ? checksumInfo : undefined);
  if (!raw) return undefined;
  const [description, optsRaw, usageRaw, bitFlags = 0] = raw;
  const usage = usageRaw || "[OPTION]... [FILE]...";
  const options = optsRaw ? optsRaw.split("|") : [];
  const flags = new Map<string, "none" | "required" | "optional">();
  for (const option of options) {
    const takesValue = option.includes("[=") ? "optional" : option.includes("=") ? "required" : "none";
    for (const spelling of option.split(", ")) flags.set(spelling.split("=")[0]!.split("[")[0]!, takesValue);
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") break;
    if (arg === "--help" || arg === "--version") {
      if (arg === "--help" && (bitFlags & 4)) return undefined;
      return arg === "--version"
        ? `${name} (safe-bash virtual implementation)\n`
        : `Usage: ${name} ${usage}\n${description}\n\nCommon supported options (additional behavior is documented in the package):\n${options.map(option => `  ${option.split(", ").map(spelling => spelling.startsWith("--") ? spelling : spelling.replace("=", " ")).join(", ")}`).join("\n")}\n  --help     display this help and exit\n  --version  display implementation information and exit\n\nThis is the safe-bash virtual implementation; filesystem operations require backend capabilities.\n`;
    }
    if (!arg.startsWith("-") || arg === "-") {
      if ((bitFlags & 1) || ((bitFlags & 2) && posixlyCorrect)) break;
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

export function gnuInformation(name: string, context: CommandContext): Promise<CommandResult | undefined> | undefined {
  if (!context.args.includes("--help") && !context.args.includes("--version")) return undefined;
  return gnuInformationSlow(name, context);
}

async function gnuInformationSlow(name: string, context: CommandContext): Promise<CommandResult | undefined> {
  const posix = context.env.POSIXLY_CORRECT !== undefined;
  if (name === "echo" && posix) return undefined;
  const ext = Boolean((context as { externalInvocation?: boolean }).externalInvocation);
  if (name === "pwd" && !ext) return undefined;
  const text = gnuInformationSync(name, context.args, ext, posix);
  if (text === undefined) return undefined;
  await writeBytes(context.stdout, sharedEncoder.encode(text), context.signal);
  return { exitCode: name === "false" ? 1 : 0 };
}
