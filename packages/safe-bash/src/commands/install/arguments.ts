import type { CommandContext } from "../../contracts/index.js";
import { getCommandArguments } from "../../contracts/command.js";
import { InstallError, quote, type InstallCommandsOptions } from "./options.js";

export interface InstallArguments {
  files: string[];
  directory: boolean;
  parents: boolean;
  compare: boolean;
  preserve: boolean;
  strip: boolean;
  stripProgram: string;
  stripProgramSpecified: boolean;
  verbose: boolean;
  debug: boolean;
  noTarget: boolean;
  target?: string;
  mode?: string;
  modeBytes?: Uint8Array;
  owner?: string;
  group?: string;
  backup: "none" | "simple" | "existing" | "numbered";
  suffix: string;
  contextMode?: "default" | "preserve" | "explicit";
  contextLabel?: string;
  display?: "help" | "version";
}

export async function parseArguments(context: CommandContext, options: InstallCommandsOptions, warn: (message: string) => Promise<void>): Promise<InstallArguments> {
  const result: InstallArguments = { files: [], directory: false, parents: false, compare: false, preserve: false, strip: false,
    stripProgram: "strip", stripProgramSpecified: false, verbose: false, debug: false, noTarget: false, backup: "none", suffix: context.env.SIMPLE_BACKUP_SUFFIX || "~" };
  const longOptions: Readonly<Record<string, string>> = { backup: "b", compare: "C", context: "Z", debug: "debug", directory: "d", group: "g", mode: "m", "no-target-directory": "T", owner: "o", "preserve-timestamps": "p", "preserve-context": "preserve-context", strip: "s", "strip-program": "strip-program", suffix: "S", "target-directory": "t", verbose: "v", help: "help", version: "version" };
  const supplied = getCommandArguments(context), args = supplied.args;
  let ended = false, makeBackups = false, control: string | undefined;
  let preserveContext = false, setContext = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const argumentIndex = index;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      result.files.push(argument);
      if (Object.hasOwn(context.env, "POSIXLY_CORRECT")) ended = true;
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    const long = argument.startsWith("--"), equals = argument.indexOf("=");
    let name = argument.slice(2, equals < 0 ? undefined : equals), keys = argument.slice(1);
    if (long) {
      const matches = Object.keys(longOptions).filter(option => option.startsWith(name));
      if (!matches.length) throw new InstallError(`unrecognized option '${argument}'`, true);
      if (!Object.hasOwn(longOptions, name) && matches.length > 1) throw new InstallError(`option '${argument}' is ambiguous; possibilities: ${matches.map(option => `'--${option}'`).join(" ")}`, true);
      name = Object.hasOwn(longOptions, name) ? name : matches[0]!;
      keys = longOptions[name]!;
    }
    const tokens = long ? [keys] : Array.from(keys);
    for (let offset = 0; offset < tokens.length; offset++) {
      const key = tokens[offset]!;
      if (!long && !"bcCsDdg:m:o:pt:TvS:Z".includes(key) || key === ":") throw new InstallError(`invalid option -- '${key}'`, true);
      const required = ["g", "m", "o", "t", "S", "strip-program"].includes(key), optional = long && (key === "b" || key === "Z");
      if (long && equals >= 0 && !required && !optional) throw new InstallError(`option '--${name}' doesn't allow an argument`, true);
      let value: string | undefined;
      if (required) {
        value = long ? equals >= 0 ? argument.slice(equals + 1) : args[++index] : keys.slice(offset + 1) || args[++index];
        if (value === undefined) throw new InstallError(long ? `option '--${name}' requires an argument` : `option requires an argument -- '${key}'`, true);
      } else if (optional && equals >= 0) value = argument.slice(equals + 1);
      switch (key) {
        case "help": case "version": result.display = key; return result;
        case "b": makeBackups = true; if (value !== undefined) control = value; break;
        case "c": break;
        case "C": result.compare = true; break;
        case "d": result.directory = true; break;
        case "D": result.parents = true; break;
        case "p": result.preserve = true; break;
        case "s": result.strip = true; break;
        case "v": result.verbose = true; break;
        case "debug": result.debug = result.verbose = true; break;
        case "T": result.noTarget = true; break;
        case "t": if (result.target !== undefined) throw new InstallError("multiple target directories specified"); result.target = value!; break;
        case "g": result.group = value!; break;
        case "o": result.owner = value!; break;
        case "m": {
          result.mode = value!;
          const attached = long ? equals >= 0 : keys.slice(offset + 1).length > 0;
          const bytes = supplied.bytes(attached ? argumentIndex : index)!;
          result.modeBytes = attached ? bytes.slice(long ? equals + 1 : offset + 2) : bytes;
          break;
        }
        case "S": makeBackups = true; result.suffix = value!; break;
        case "strip-program": result.stripProgram = value!; result.stripProgramSpecified = true; break;
        case "Z":
          if (options.securityContext?.enabled === false) { if (value !== undefined) await warn("warning: ignoring --context; it requires an SELinux-enabled kernel"); }
          else { setContext = true; result.contextMode = value === undefined ? "default" : "explicit"; if (value !== undefined) result.contextLabel = value; }
          break;
        case "preserve-context":
          if (options.securityContext?.enabled === false) await warn("WARNING: ignoring --preserve-context; this kernel is not SELinux-enabled");
          else { preserveContext = true; result.contextMode = "preserve"; }
          break;
      }
      if (required) break;
    }
  }
  if (result.directory && result.strip) throw new InstallError("the strip option may not be used when installing a directory");
  if (result.directory && result.target !== undefined) throw new InstallError("target directory not allowed when installing a directory");
  if (!result.suffix || result.suffix.includes("/")) result.suffix = "~";
  if (makeBackups) {
    const aliases = { none: "none", off: "none", simple: "simple", never: "simple", existing: "existing", nil: "existing", numbered: "numbered", t: "numbered" } as const;
    const requested = control || context.env.VERSION_CONTROL || "existing";
    const matches = Object.keys(aliases).filter(alias => alias.startsWith(requested)) as (keyof typeof aliases)[];
    if (Object.hasOwn(aliases, requested)) result.backup = aliases[requested as keyof typeof aliases];
    else if (matches.length && new Set(matches.map(alias => aliases[alias])).size === 1) result.backup = aliases[matches[0]!];
    else throw new InstallError(`${matches.length ? "ambiguous" : "invalid"} argument ${quote(requested, true)} for 'backup type'\nValid arguments are:\n  - 'none', 'off'\n  - 'simple', 'never'\n  - 'existing', 'nil'\n  - 'numbered', 't'`, true);
  }
  if (preserveContext && setContext) throw new InstallError("cannot set target context and preserve it");
  if (!result.files.length) throw new InstallError("missing file operand", true);
  if (result.files.length === 1 && !result.directory && result.target === undefined) throw new InstallError(`missing destination file operand after ${quote(result.files[0]!)}`, true);
  if (result.noTarget && result.target !== undefined) throw new InstallError("cannot combine --target-directory (-t) and --no-target-directory (-T)");
  if (result.noTarget && result.files.length > 2) throw new InstallError(`extra operand ${quote(result.files[2]!)}`, true);
  return result;
}

export const helpText = `Usage: install [OPTION]... [-T] SOURCE DEST
  or:  install [OPTION]... SOURCE... DIRECTORY
  or:  install [OPTION]... -t DIRECTORY SOURCE...
  or:  install [OPTION]... -d DIRECTORY...

This install program copies files (often just compiled) into destination
locations you choose.  If you want to download and install a ready-to-use
package on a GNU/Linux system, you should instead be using a package manager
like yum(1) or apt-get(1).

In the first three forms, copy SOURCE to DEST or multiple SOURCE(s) to
the existing DIRECTORY, while setting permission modes and owner/group.
In the 4th form, create all components of the given DIRECTORY(ies).

Mandatory arguments to long options are mandatory for short options too.
      --backup[=CONTROL]  make a backup of each existing destination file
  -b                  like --backup but does not accept an argument
  -c                  (ignored)
  -C, --compare       compare content of source and destination files, and
                        if no change to content, ownership, and permissions,
                        do not modify the destination at all
  -d, --directory     treat all arguments as directory names; create all
                        components of the specified directories
  -D                  create all leading components of DEST except the last,
                        or all components of --target-directory,
                        then copy SOURCE to DEST
      --debug         explain how a file is copied.  Implies -v
  -g, --group=GROUP   set group ownership, instead of process' current group
  -m, --mode=MODE     set permission mode (as in chmod), instead of rwxr-xr-x
  -o, --owner=OWNER   set ownership (super-user only)
  -p, --preserve-timestamps   apply access/modification times of SOURCE files
                        to corresponding destination files
  -s, --strip         strip symbol tables
      --strip-program=PROGRAM  program used to strip binaries
  -S, --suffix=SUFFIX  override the usual backup suffix
  -t, --target-directory=DIRECTORY  copy all SOURCE arguments into DIRECTORY
  -T, --no-target-directory  treat DEST as a normal file
  -v, --verbose       print the name of each created file or directory
      --preserve-context  preserve SELinux security context
  -Z                      set SELinux security context of destination
                            file and each created directory to default type
      --context[=CTX]     like -Z, or if CTX is specified then set the
                            SELinux or SMACK security context to CTX
      --help        display this help and exit
      --version     output version information and exit

The backup suffix is '~', unless set with --suffix or SIMPLE_BACKUP_SUFFIX.
The version control method may be selected via the --backup option or through
the VERSION_CONTROL environment variable.  Here are the values:

  none, off       never make backups (even if --backup is given)
  numbered, t     make numbered backups
  existing, nil   numbered if numbered backups exist, simple otherwise
  simple, never   always make simple backups

GNU coreutils online help: <https://www.gnu.org/software/coreutils/>
Report any translation bugs to <https://translationproject.org/team/>
Full documentation <https://www.gnu.org/software/coreutils/install>
or available locally via: info '(coreutils) install invocation'
`;
