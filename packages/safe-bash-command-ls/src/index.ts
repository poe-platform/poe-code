import { FsError, joinPath, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { escapeText, quoteShellOperand } from "safe-bash-contracts/escaping";
import { codeOf, define, eachOperand, options, output, pathOf, UsageError } from "safe-bash-io-engine/internal";
import { maybeStat, needCapability, childOperand } from "safe-bash-io-engine/commands/filesystem-operands";
import { admitFilesystemModes, filesystemCommandRequirements } from "safe-bash-io-engine/commands/filesystem-requirements";
import { createDirectoryReader } from "safe-bash-io-engine/commands/directory-admission";
import { millisecondsInstant, TimeZone } from "safe-bash-calendar-engine/time-env/calendar";
import { formatDate } from "safe-bash-calendar-engine/time-env/format";
import { ownEnvironment, settings, type TimeEnvLimits } from "safe-bash-calendar-engine/time-env/shared";

export interface LsLimits extends Pick<TimeEnvLimits, "maxOutputBytes" | "maxFormatWidth"> {
  readonly maxDirectoryEntries: number;
  readonly maxRecursiveDirectoryDepth: number;
}

export interface LsCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<LsLimits>;
}

const quotingStyles = ["literal", "shell", "shell-always", "shell-escape", "shell-escape-always", "c", "c-maybe", "escape", "locale", "clocale"] as const;

function modeText(stat: FileStat): string {
  let text = stat.type === "directory" ? "d" : stat.type === "symlink" ? "l" : stat.type === "character" ? "c" : "-";
  for (const shift of [6, 3, 0]) {
    const mode = stat.mode >> shift;
    text += (mode & 4 ? "r" : "-") + (mode & 2 ? "w" : "-") + (mode & 1 ? "x" : "-");
  }
  if (stat.mode & 0o4000) text = text.slice(0, 3) + (stat.mode & 0o100 ? "s" : "S") + text.slice(4);
  if (stat.mode & 0o2000) text = text.slice(0, 6) + (stat.mode & 0o010 ? "s" : "S") + text.slice(7);
  if (stat.mode & 0o1000) text = text.slice(0, 9) + (stat.mode & 0o001 ? "t" : "T");
  return text;
}

export function createLsCommand(configuration: LsCommandsOptions = {}): CommandDefinition {
  const maxRecursiveDirectoryDepth = configuration.limits?.maxRecursiveDirectoryDepth ?? Infinity;
  if (maxRecursiveDirectoryDepth !== Infinity && (!Number.isSafeInteger(maxRecursiveDirectoryDepth) || maxRecursiveDirectoryDepth < 0)) {
    throw new RangeError("maxRecursiveDirectoryDepth must be a nonnegative safe integer or Infinity");
  }
  const readDirectory = createDirectoryReader(configuration.limits?.maxDirectoryEntries);
  const timeLimits = settings({ limits: {
    maxOutputBytes: configuration.limits?.maxOutputBytes ?? Infinity,
    maxFormatWidth: Math.min(configuration.limits?.maxFormatWidth ?? Infinity, configuration.limits?.maxOutputBytes ?? Infinity),
  } }).limits;
  const definition = define("ls", async context => {
    const now = Date.now();
    let hidden: "none" | "all" | "almost-all" = "none";
    let sort: "name" | "time" | "size" | "none" | "extension" | "version" = "name";
    let timeKey: "mtimeMs" | "atimeMs" | "ctimeMs" = "mtimeMs";
    let timeStyle = "locale";
    let indicator: "none" | "slash" | "file-type" | "classify" = "none";
    let quotingStyle: typeof quotingStyles[number] = "literal";
    let groupDirectoriesFirst = false;
    let layout: "single-column" | "long" | "commas" | "vertical" | "horizontal" = "single-column";
    let showOwner = true;
    let showGroup = true;
    let width = 80;
    const selectWidth = (selection: string | undefined): void => {
      if (selection === undefined) throw new UsageError("option requires an argument -- 'w'");
      if (!selection || !Array.from(selection).every(char => char >= "0" && char <= "9") || !Number.isSafeInteger(Number(selection))) {
        throw new UsageError(`invalid line width: '${selection}'`);
      }
      width = Number(selection);
    };
    let ended = false;
    const args: string[] = [];
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (!ended && (argument === "--time-style" || argument.startsWith("--time-style="))) {
        const selection = argument === "--time-style" ? context.args[++index] : argument.slice(13);
        if (selection === undefined) throw new UsageError("option '--time-style' requires an argument");
        timeStyle = selection;
        continue;
      }
      if (!ended && argument === "--full-time") {
        timeStyle = "full-iso";
        args.push("-l");
        layout = "long";
        continue;
      }
      if (!ended && argument === "--group-directories-first") {
        groupDirectoriesFirst = true;
        continue;
      }
      if (!ended && (argument === "--width" || argument.startsWith("--width="))) {
        selectWidth(argument === "--width" ? context.args[++index] : argument.slice(8));
        continue;
      }
      if (!ended && (argument === "--format" || argument.startsWith("--format="))) {
        const selection = argument === "--format" ? context.args[++index] : argument.slice(9);
        if (selection === undefined) throw new UsageError("option '--format' requires an argument");
        const formats = { across: "horizontal", commas: "commas", horizontal: "horizontal", long: "long", "single-column": "single-column", verbose: "long", vertical: "vertical" } as const;
        const matches = Object.keys(formats).filter(name => name.startsWith(selection));
        const name = Object.hasOwn(formats, selection) ? selection : matches.length === 1 ? matches[0] : undefined;
        if (name === undefined) throw new UsageError(`invalid argument '${selection}' for '--format'`);
        layout = formats[name as keyof typeof formats];
        continue;
      }
      if (!ended && (argument === "--color" || argument === "--colour" || argument.startsWith("--color=") || argument.startsWith("--colour="))) {
        const equals = argument.indexOf("=");
        const selection = equals < 0 ? "always" : argument.slice(equals + 1);
        if (selection !== "never" && selection !== "auto" && selection !== "always") {
          throw new UsageError(`invalid argument '${selection}' for '--color'`);
        }
        // Listings use plain text even when callers request terminal colors.
        continue;
      }
      if (!ended && (argument === "--time" || argument.startsWith("--time="))) {
        const selection = argument === "--time" ? context.args[++index] : argument.slice(7);
        if (selection === undefined) throw new UsageError("option '--time' requires an argument");
        const aliases = { mtime: "mtimeMs", modification: "mtimeMs", atime: "atimeMs", access: "atimeMs", use: "atimeMs", ctime: "ctimeMs", status: "ctimeMs" } as const;
        const matches = Object.keys(aliases).filter(alias => alias.startsWith(selection));
        const alias = Object.hasOwn(aliases, selection) ? selection : matches.length === 1 ? matches[0] : undefined;
        if (alias === undefined) throw new UsageError(`invalid argument '${selection}' for '--time'`);
        timeKey = aliases[alias as keyof typeof aliases];
        continue;
      }
      if (!ended && (argument === "--sort" || argument.startsWith("--sort="))) {
        const selection = argument === "--sort" ? context.args[++index] : argument.slice(7);
        if (selection !== "time" && selection !== "size" && selection !== "none" && selection !== "name" && selection !== "extension" && selection !== "version") {
          throw new UsageError("--sort requires 'time' or 'size'");
        }
        sort = selection;
        if (selection === "time") args.push("-t");
        else if (selection === "size") args.push("-S");
        else if (selection === "none") args.push("-U");
        else if (selection === "extension") args.push("-X");
        else if (selection === "version") args.push("-v");
        continue;
      }
      if (!ended && (argument === "--indicator-style" || argument.startsWith("--indicator-style="))) {
        const selection = argument === "--indicator-style" ? context.args[++index] : argument.slice(18);
        if (selection === undefined) throw new UsageError("option '--indicator-style' requires an argument");
        const styles = ["none", "slash", "file-type", "classify"] as const;
        const matches = styles.filter(style => style.startsWith(selection));
        if (matches.length !== 1) {
          throw new PublicDiagnostic(`${matches.length ? "ambiguous" : "invalid"} argument '${selection}' for '--indicator-style'\nValid arguments are:\n${styles.map(style => `  - '${style}'`).join("\n")}\nTry 'ls --help' for more information.`);
        }
        indicator = matches[0]!;
        continue;
      }
      if (!ended && argument === "--classify") indicator = "classify";
      if (!ended && argument === "--file-type") { indicator = "file-type"; continue; }
      if (!ended && argument === "--ignore-backups") { args.push("-B"); continue; }
      if (argument === "--") ended = true;
      if (!ended && argument.startsWith("-") && !argument.startsWith("--") && argument !== "-") {
        for (let offset = 1; offset < argument.length; offset++) {
          const flag = argument[offset]!;
          if (flag === "w") { selectWidth(argument.slice(offset + 1) || context.args[++index]); break; }
          if (flag === "l" || flag === "n") layout = "long";
          else if (flag === "g") { layout = "long"; showOwner = false; }
          else if (flag === "o") { layout = "long"; showGroup = false; }
          else if (flag === "G") showGroup = false;
          else if (flag === "1") { if (layout !== "long") layout = "single-column"; }
          else if (flag === "m") layout = "commas";
          else if (flag === "x") layout = "horizontal";
          else if (flag === "C") layout = "vertical";
          else args.push(`-${flag}`);
          if (flag === "t") sort = "time";
          else if (flag === "c") timeKey = "ctimeMs";
          else if (flag === "u") timeKey = "atimeMs";
          else if (flag === "S") sort = "size";
          else if (flag === "U") sort = "none";
          else if (flag === "f") { sort = "none"; hidden = "all"; }
          else if (flag === "X") sort = "extension";
          else if (flag === "v") sort = "version";
          else if (flag === "F") indicator = "classify";
          else if (flag === "p") indicator = "slash";
        }
      } else args.push(argument);
    }
    const parsed = options(args, "aAl1dFprRLhtSQcuiUfXvBbN", { inode: "i", "quote-name": "Q", escape: "b", literal: "N", "quoting-style": "quoting-style:", all: "a", "almost-all": "A", directory: "d", classify: "F", reverse: "r", recursive: "R", dereference: "L", "human-readable": "h", "ignore-backups": "B" }, false, undefined, undefined, (key, selection) => {
      if (key === "Q") quotingStyle = "c";
      else if (key === "b") quotingStyle = "escape";
      else if (key === "N") quotingStyle = "literal";
      else if (key === "quoting-style") {
        const matches = quotingStyles.filter(style => style === selection);
        const candidates = matches.length ? matches : quotingStyles.filter(style => selection && style.startsWith(selection));
        if (candidates.length !== 1) throw new UsageError(`invalid argument '${selection}' for '--quoting-style'`);
        quotingStyle = candidates[0]!;
      }
      if (key === "f") hidden = "all";
      if (key === "a") hidden = "all";
      else if (key === "A") hidden = "almost-all";
    });
    if (layout === "long") parsed.flags.add("l");
    let timeFormats = ["%b %e %_5Y", "%b %e %H:%M"];
    if (parsed.flags.has("l")) {
      if (timeStyle.startsWith("+")) {
        timeFormats = timeStyle.slice(1).split("\n");
        if (timeFormats.length > 2) throw new UsageError("invalid time style format: expected at most one newline");
      } else {
        const styles = ["full-iso", "long-iso", "iso", "locale"];
        const matches = styles.filter(style => style.startsWith(timeStyle));
        if (matches.length !== 1) throw new UsageError(`${matches.length ? "ambiguous" : "invalid"} argument '${timeStyle}' for '--time-style'`);
        if (matches[0] === "full-iso") timeFormats = ["%Y-%m-%d %H:%M:%S.%N %z"];
        else if (matches[0] === "long-iso") timeFormats = ["%Y-%m-%d %H:%M"];
        else if (matches[0] === "iso") timeFormats = ["%Y-%m-%d ", "%m-%d %H:%M"];
      }
    }
    const timeZone = parsed.flags.has("l") ? new TimeZone(ownEnvironment(context, "TZ") ?? "UTC") : undefined;
    if (sort === "name" && timeKey !== "mtimeMs" && !parsed.flags.has("l")) sort = "time";
    const locale = (context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C").toLowerCase();
    const utf8 = locale.includes("utf-8") || locale.includes("utf8");
    const nonprintable = (character: string): boolean => {
      const point = character.codePointAt(0)!;
      return point < 32 || point >= 127 && (!utf8 || point <= 159 || point === 0x2028 || point === 0x2029);
    };
    const formatName = (name: string): string => {
      if (quotingStyle === "literal") return name;
      if (quotingStyle.startsWith("shell")) {
        const escaped = quotingStyle.startsWith("shell-escape");
        const special = [...name].some(character => " \t\n\r\"'`$&*;<>?[\\]^|=(){}!".includes(character)
          || escaped && nonprintable(character));
        if (!quotingStyle.endsWith("always") && name && !special && !"#~".includes(name[0]!)) return name;
        if (escaped) return quoteShellOperand(name, utf8);
        if (name.includes("'") && !["$", "`", "\\", '"'].some(character => name.includes(character))) return `"${name}"`;
        return "'" + name.split("'").join("'\\''") + "'";
      }
      if (quotingStyle === "c-maybe" && ![...name].some(character => character === '"' || nonprintable(character))) return name;
      let open = '"', close = '"';
      if (quotingStyle === "escape") open = close = "";
      else if (quotingStyle === "locale" || quotingStyle === "clocale") {
        open = utf8 ? "‘" : quotingStyle === "locale" ? "'" : '"';
        close = utf8 ? "’" : open;
      }
      let quoted = open;
      for (const character of name) {
        if (character === "\\" || character === close || quotingStyle === "escape" && character === " ") quoted += "\\" + character;
        else if (character === "\x07") quoted += "\\a";
        else quoted += nonprintable(character) ? escapeText(character, "display") : character;
      }
      return quoted + close;
    };
    const operands = parsed.operands.length ? parsed.operands : ["."];
    interface ListingEntry { path: string; display: string; stat: FileStat | Pick<FileStat, "type"> }
    let outputWritten = false;
    const inspect = async (path: string, display: string, operand = false): Promise<ListingEntry> => {
      await admitFilesystemModes(context, "ls", ["entry"], [path]);
      let stat = await context.fs[parsed.flags.has("L") ? "stat" : "lstat"](path, { signal: context.signal });
      context.signal.throwIfAborted();
      if (operand && stat.type === "symlink" && !parsed.flags.has("L") && !parsed.flags.has("d") && !parsed.flags.has("l") && indicator !== "classify") {
        try {
          const target = await context.fs.stat(path, { signal: context.signal });
          if (target.type === "directory") stat = target;
        } catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR" && codeOf(error) !== "ELOOP") throw error; }
        context.signal.throwIfAborted();
      }
      return { path, display, stat };
    };
    const order = async (entries: ListingEntry[], lexical = false): Promise<void> => {
      await yieldTurn(context.signal);
      if (sort === "none") return;
      if (sort !== "name" || !lexical) entries.sort((left, right) => {
        context.signal.throwIfAborted();
        if (sort === "time" || sort === "size") {
          if (!("size" in left.stat) || !("size" in right.stat)) throw new Error("ls metadata sorting requires file stats");
          const key = sort === "time" ? timeKey : "size";
          if (left.stat[key] > right.stat[key]) return -1;
          if (left.stat[key] < right.stat[key]) return 1;
        } else if (sort === "extension") {
          const extOf = (s: string) => { const dot = s.lastIndexOf("."); return dot > 0 ? s.slice(dot + 1) : ""; };
          const le = extOf(left.display), re = extOf(right.display);
          if (le !== re) return le < re ? -1 : 1;
        } else if (sort === "version") {
          const cmp = left.display.localeCompare(right.display, undefined, { numeric: true });
          if (cmp !== 0) return cmp;
        }
        return left.display < right.display ? -1 : left.display > right.display ? 1 : 0;
      });
      if (parsed.flags.has("r")) entries.reverse();
      if (groupDirectoriesFirst) entries.sort((left, right) => {
        context.signal.throwIfAborted();
        return left.stat.type === "directory" ? (right.stat.type === "directory" ? 0 : -1) : right.stat.type === "directory" ? 1 : 0;
      });
      await yieldTurn(context.signal);
    };
    const humanSize = (size: number, path: string): string => {
      if (!Number.isSafeInteger(size) || size < 0) throw new FsError("EINVAL", { path, message: "human-readable size must be a nonnegative safe integer" });
      if (size < 1024) return String(size);
      const bytes = BigInt(size);
      const units = "KMGTPEZY";
      let unit = 0;
      let scale = 1024n;
      while (unit < units.length - 1 && bytes > 1023n * scale) { scale *= 1024n; unit++; }
      const tenths = (bytes * 10n + scale - 1n) / scale;
      return (tenths < 100n ? `${tenths / 10n}.${tenths % 10n}` : String((bytes + scale - 1n) / scale)) + units[unit]!;
    };
    const suffixFor = (stat: ListingEntry["stat"]): string => {
      if (stat.type === "directory" && indicator !== "none") return "/";
      if ((indicator === "file-type" || indicator === "classify") && stat.type === "symlink") return "@";
      if (indicator === "classify" && stat.type === "file") {
        if (!("mode" in stat)) throw new Error("ls file classification requires file stats");
        if (stat.mode & 0o111) return "*";
      }
      return "";
    };
    const render = async ({ path, display, stat }: ListingEntry): Promise<void> => {
      let suffix = suffixFor(stat);
      const inode = parsed.flags.has("i") ? `${"ino" in stat ? stat.ino ?? "?" : "?"} ` : "";
      if (parsed.flags.has("l")) {
        if (!("size" in stat)) throw new Error("ls long listing requires file stats");
        let size = parsed.flags.has("h") ? humanSize(stat.size, path) : String(stat.size);
        // GNU ls uses half an average Gregorian year to classify recent times.
        const recent = stat[timeKey] > now - 15_778_476_000 && stat[timeKey] <= now;
        const date = formatDate(timeFormats[recent && timeFormats.length === 2 ? 1 : 0]!,
          millisecondsInstant(stat[timeKey]), timeZone!, timeLimits).slice(0, -1);
        let target = "";
        if (stat.type === "symlink") {
          await admitFilesystemModes(context, "ls", ["link"], [path]);
          needCapability(context, "readlink");
          const link = await context.fs.readlink!(path, { signal: context.signal });
          const targetStat = indicator === "none" || indicator === "slash" ? undefined : await maybeStat(context, path).catch(error => {
            context.signal.throwIfAborted();
            if (codeOf(error) === "ENOTDIR" || codeOf(error) === "ELOOP") return undefined;
            throw error;
          });
          suffix = "";
          target = ` -> ${formatName(link)}${targetStat ? suffixFor(targetStat) : ""}`;
        }
        if (stat.type === "character") {
          for (const number of [stat.rdevMajor, stat.rdevMinor]) {
            if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) {
              throw new FsError("EIO", { path, message: "invalid device number" });
            }
          }
          size = `${stat.rdevMajor ?? "?"}, ${stat.rdevMinor ?? "?"}`;
        }
        await output(context, `${inode}${modeText(stat)} ${stat.nlink ?? 1}${showOwner ? ` ${stat.uid ?? 0}` : ""}${showGroup ? ` ${stat.gid ?? 0}` : ""} ${size} ${date} ${formatName(display)}${suffix}${target}\n`);
      } else await output(context, `${inode}${formatName(display)}${suffix}\n`);
      outputWritten = true;
    };
    const renderEntries = async (entries: ListingEntry[]): Promise<void> => {
      if (layout === "long" || layout === "single-column") {
        for (const entry of entries) await render(entry);
        return;
      }
      const names = entries.map(({ display, stat }) => `${parsed.flags.has("i") ? `${"ino" in stat ? stat.ino ?? "?" : "?"} ` : ""}${formatName(display)}${suffixFor(stat)}`);
      if (layout === "commas") {
        let line = "";
        for (const [index, name] of names.entries()) {
          if (index % 128 === 0) await yieldTurn(context.signal);
          const next = name + (index < names.length - 1 ? "," : "");
          if (line && width && line.length + 1 + next.length > width) {
            await output(context, line + "\n");
            line = "";
          }
          line += (line ? " " : "") + next;
        }
        if (line) await output(context, line + "\n");
      } else if (names.length) {
        let columns = width ? Math.min(names.length, Math.max(1, Math.floor((width + 2) / 3))) : names.length;
        let widths: number[] = [];
        let rows = 0;
        for (; columns > 0; columns--) {
          await yieldTurn(context.signal);
          rows = Math.ceil(names.length / columns);
          widths = Array<number>(columns).fill(0);
          for (let index = 0; index < names.length; index++) {
            if (index % 128 === 0) await yieldTurn(context.signal);
            const column = layout === "vertical" ? Math.floor(index / rows) : index % columns;
            widths[column] = Math.max(widths[column]!, names[index]!.length);
          }
          if (!width || columns === 1 || widths.reduce((sum, size) => sum + size, 0) + 2 * (columns - 1) <= width) break;
        }
        for (let row = 0; row < rows; row++) {
          let line = "";
          for (let column = 0; column < columns; column++) {
            const index = layout === "vertical" ? column * rows + row : row * columns + column;
            if (index >= names.length) break;
            const name = names[index]!;
            const next = layout === "vertical" ? index + rows : index + 1;
            line += name;
            if (column < columns - 1 && next < names.length) line += " ".repeat(widths[column]! - name.length + 2);
          }
          await output(context, line + "\n");
        }
      }
      if (entries.length) outputWritten = true;
    };
    const list = async ({ path, display, stat }: ListingEntry, header: boolean, ancestors = new Set<string>()): Promise<void> => {
      context.signal.throwIfAborted();
      await admitFilesystemModes(context, "ls", ["directory"], [path]);
      const physical = await context.fs.realpath(path, { signal: context.signal });
      if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
      context.signal.throwIfAborted();
      if (ancestors.size > maxRecursiveDirectoryDepth) {
        throw new FsError("ELOOP", { path, message: `ls directory depth limit exceeded (${maxRecursiveDirectoryDepth})` });
      }
      ancestors.add(physical);
      try {
        if (header) { await output(context, `${outputWritten ? "\n" : ""}${formatName(display)}:\n`); outputWritten = true; }
        const entries = await readDirectory(context, path, true);
        const byName = new Map(entries.map(entry => [entry.name, entry.type] as const));
        const names = entries.map(entry => entry.name).filter(name => (hidden !== "none" || !name.startsWith(".")) && (!parsed.flags.has("B") || !name.endsWith("~")));
        if (hidden === "all") for (const name of [".", ".."]) {
          const index = names.findIndex(entry => entry > name);
          names.splice(index < 0 ? names.length : index, 0, name);
        }
        const needsStat = parsed.flags.has("l") || parsed.flags.has("i") || sort === "time" || sort === "size";
        const children: ListingEntry[] = [];
        for (const [index, name] of names.entries()) {
          if (index % 128 === 0) await yieldTurn(context.signal);
          const childPath = joinPath(path, name);
          const entryType = byName.get(name) ?? "directory";
          if (needsStat || (parsed.flags.has("L") && entryType === "symlink") || (indicator === "classify" && entryType === "file")) {
            children.push(await inspect(childPath, name));
          } else {
            children.push({
              path: childPath,
              display: name,
              stat: name === "." ? stat : { type: entryType },
            });
          }
        }
        await order(children, true);
        if (parsed.flags.has("l")) {
          let totalBytes = 0;
          for (const child of children) {
            if (!("size" in child.stat)) throw new Error("ls long listing requires file stats");
            // Virtual filesystems may omit allocation; estimate only the display,
            // without presenting logical size as provider-reported allocation.
            totalBytes += child.stat.allocatedBytes ?? Math.ceil(child.stat.size / 4096) * 4096;
          }
          await output(context, `total ${parsed.flags.has("h") ? humanSize(totalBytes, path) : Math.ceil(totalBytes / 1024)}\n`);
          outputWritten = true;
        }
        await renderEntries(children);
        if (parsed.flags.has("R")) for (const child of children) {
          if (child.display === "." || child.display === "..") continue;
          if (child.stat.type === "directory") await list({ ...child, display: childOperand(display, child.display) }, true, ancestors);
        }
      } finally { ancestors.delete(physical); }
    };
    const entries: ListingEntry[] = [];
    let admitted = 0;
    const result = await eachOperand(context, operands, async operand => {
      if (admitted++ % 128 === 0) await yieldTurn(context.signal);
      entries.push(await inspect(pathOf(context, operand), operand, true));
    });
    if (result.exitCode !== 0) result.exitCode = 2;
    const files = entries.filter(entry => parsed.flags.has("d") || entry.stat.type !== "directory");
    const directories = entries.filter(entry => !parsed.flags.has("d") && entry.stat.type === "directory");
    await order(files);
    await order(directories);
    if (layout === "single-column" || layout === "long") {
      for (const entry of files) {
        const rendered = await eachOperand(context, [entry.display], async () => render(entry));
        result.exitCode = Math.max(result.exitCode, rendered.exitCode);
      }
    } else await renderEntries(files);
    for (const entry of directories) {
      const rendered = await eachOperand(context, [entry.display], async () => {
        await list(entry, operands.length > 1 || parsed.flags.has("R"));
      });
      result.exitCode = Math.max(result.exitCode, rendered.exitCode);
    }
    return result;
  });
  return { ...definition, filesystemRequirements: filesystemCommandRequirements.ls };
}

export function createLsCommands(options: LsCommandsOptions = {}): readonly CommandDefinition[] {
  return [createLsCommand(options)];
}

export function lsCommands(options: LsCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLsCommands(options);
  return {
    name: "ls-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
