import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface LocaleLimits {
  readonly maxArgumentBytes: number;
}

export interface LocaleCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly locales?: readonly string[] | undefined;
  readonly charmaps?: readonly string[] | undefined;
  readonly defaultLocale?: string | undefined;
  readonly limits?: Partial<LocaleLimits> | undefined;
}

export type LocaleOptions = LocaleCommandsOptions;

export function settings(options: LocaleCommandsOptions = {}): LocaleLimits {
  const limits: LocaleLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? 64 * 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const DEFAULT_SUPPORTED_LOCALES = Object.freeze([
  "C",
  "C.utf8",
  "C.UTF-8",
  "POSIX",
  "en_US.utf8",
  "en_US.UTF-8",
  "UTF-8",
]);

const DEFAULT_SUPPORTED_CHARMAPS = Object.freeze([
  "ANSI_X3.4-1968",
  "ASCII",
  "ISO-8859-1",
  "UTF-8",
]);

const LC_CATEGORIES = Object.freeze([
  "LC_CTYPE",
  "LC_NUMERIC",
  "LC_TIME",
  "LC_COLLATE",
  "LC_MONETARY",
  "LC_MESSAGES",
  "LC_PAPER",
  "LC_NAME",
  "LC_ADDRESS",
  "LC_TELEPHONE",
  "LC_MEASUREMENT",
  "LC_IDENTIFICATION",
]);

const HELP_TEXT = `Usage: locale [OPTION...] [NAME...]
Get locale-specific information for the Sandbox VFS-ish/GNU environment.

 System information:
  -a, --all-locales          Write names of available locales
  -m, --charmaps             Write names of available charmaps

 Modify output format:
  -c, --category-name        Write names of selected categories
  -k, --keyword-name         Write names of selected keywords
  -v, --verbose              Print more information
  -?, --help                 Give this help list
  -V, --version              Print program version
`;

const VERSION_TEXT = `locale (Sandbox VFS-ish/GNU libc) 2.39
`;

function effectiveLocaleForCategory(
  env: Readonly<Record<string, string | undefined>>,
  category: string,
  fallback: string
): { value: string; implied: boolean } {
  const lcAll = env.LC_ALL;
  if (lcAll !== undefined && lcAll !== "") {
    return { value: lcAll, implied: true };
  }
  const explicit = env[category];
  if (explicit !== undefined && explicit !== "") {
    return { value: explicit, implied: false };
  }
  const lang = env.LANG;
  if (lang !== undefined && lang !== "") {
    return { value: lang, implied: true };
  }
  return { value: fallback, implied: true };
}

function isUtf8Locale(locale: string): boolean {
  const upper = locale.toUpperCase();
  return upper.includes("UTF-8") || upper.includes("UTF8");
}

function getKeywordDatabase(utf8: boolean): Record<string, { category: string; value: string; quoted: boolean }> {
  const charmap = utf8 ? "UTF-8" : "ANSI_X3.4-1968";
  return {
    charmap: { category: "LC_CTYPE", value: charmap, quoted: true },
    codeset: { category: "LC_CTYPE", value: charmap, quoted: true },
    mb_cur_max: { category: "LC_CTYPE", value: utf8 ? "6" : "1", quoted: false },
    decimal_point: { category: "LC_NUMERIC", value: ".", quoted: true },
    thousands_sep: { category: "LC_NUMERIC", value: "", quoted: true },
    grouping: { category: "LC_NUMERIC", value: "-1", quoted: false },
    yesexpr: { category: "LC_MESSAGES", value: "^[yY]", quoted: true },
    noexpr: { category: "LC_MESSAGES", value: "^[nN]", quoted: true },
    yesstr: { category: "LC_MESSAGES", value: "yes", quoted: true },
    nostr: { category: "LC_MESSAGES", value: "no", quoted: true },
    abday: { category: "LC_TIME", value: "Sun;Mon;Tue;Wed;Thu;Fri;Sat", quoted: true },
    day: { category: "LC_TIME", value: "Sunday;Monday;Tuesday;Wednesday;Thursday;Friday;Saturday", quoted: true },
    abmon: { category: "LC_TIME", value: "Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec", quoted: true },
    mon: {
      category: "LC_TIME",
      value: "January;February;March;April;May;June;July;August;September;October;November;December",
      quoted: true,
    },
    d_t_fmt: { category: "LC_TIME", value: "%a %b %e %H:%M:%S %Y", quoted: true },
    d_fmt: { category: "LC_TIME", value: "%m/%d/%y", quoted: true },
    t_fmt: { category: "LC_TIME", value: "%H:%M:%S", quoted: true },
    am_pm: { category: "LC_TIME", value: "AM;PM", quoted: true },
    t_fmt_ampm: { category: "LC_TIME", value: "%I:%M:%S %p", quoted: true },
    int_curr_symbol: { category: "LC_MONETARY", value: "", quoted: true },
    currency_symbol: { category: "LC_MONETARY", value: "", quoted: true },
  };
}

export function createLocaleCommand(options: LocaleCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const sharedEncoder = new TextEncoder();
  const defaultLocale = options.defaultLocale ?? "C.UTF-8";
  const supportedLocales = options.locales ?? DEFAULT_SUPPORTED_LOCALES;
  const supportedCharmaps = options.charmaps ?? DEFAULT_SUPPORTED_CHARMAPS;

  return {
    name: "locale",
    description: "Get locale-specific information and supported locale set",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += sharedEncoder.encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "locale: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let allLocales = false;
      let allCharmaps = false;
      let showCategoryName = false;
      let showKeywordName = false;
      let verbose = false;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-?")) {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          switch (arg) {
            case "--all-locales":
              allLocales = true;
              break;
            case "--charmaps":
              allCharmaps = true;
              break;
            case "--category-name":
              showCategoryName = true;
              break;
            case "--keyword-name":
              showKeywordName = true;
              break;
            case "--verbose":
              verbose = true;
              break;
            default:
              await writeText(context.stderr, `locale: unrecognized option '${arg}'\n`);
              return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "a":
                allLocales = true;
                break;
              case "m":
                allCharmaps = true;
                break;
              case "c":
                showCategoryName = true;
                break;
              case "k":
                showKeywordName = true;
                break;
              case "v":
                verbose = true;
                break;
              default:
                await writeText(context.stderr, `locale: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      if (allLocales) {
        if (verbose) {
          const blocks = supportedLocales.map(loc => {
            const cs = isUtf8Locale(loc) ? "UTF-8" : "ANSI_X3.4-1968";
            return `locale: ${loc.padEnd(15, " ")} archive: /usr/lib/locale/locale-archive\n-------------------------------------------------------------------------------\n    title | ${loc} locale for Sandbox VFS-ish/GNU\n  codeset | ${cs}\n`;
          });
          await writeText(context.stdout, blocks.join("\n"));
        } else {
          await writeText(context.stdout, `${supportedLocales.join("\n")}\n`);
        }
        return { exitCode: 0 };
      }

      if (allCharmaps) {
        await writeText(context.stdout, `${supportedCharmaps.join("\n")}\n`);
        return { exitCode: 0 };
      }

      if (operands.length === 0) {
        const lang = context.env.LANG ?? defaultLocale;
        const lines: string[] = [`LANG=${lang}`];
        for (const cat of LC_CATEGORIES) {
          const eff = effectiveLocaleForCategory(context.env, cat, defaultLocale);
          lines.push(eff.implied ? `${cat}="${eff.value}"` : `${cat}=${eff.value}`);
        }
        lines.push(`LC_ALL=${context.env.LC_ALL ?? ""}`);
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      const ctypeLocale = effectiveLocaleForCategory(context.env, "LC_CTYPE", defaultLocale).value;
      const utf8 = isUtf8Locale(ctypeLocale);
      const keywords = getKeywordDatabase(utf8);
      const outLines: string[] = [];
      let exitCode = 0;

      for (const name of operands) {
        if ((LC_CATEGORIES as readonly string[]).includes(name)) {
          if (showCategoryName) outLines.push(name);
          const catKeywords = Object.entries(keywords).filter(([, info]) => info.category === name);
          if (catKeywords.length === 0) {
            const eff = effectiveLocaleForCategory(context.env, name, defaultLocale).value;
            outLines.push(showKeywordName ? `name="${eff}"` : eff);
          } else {
            for (const [kw, info] of catKeywords) {
              if (showKeywordName) {
                outLines.push(info.quoted ? `${kw}="${info.value}"` : `${kw}=${info.value}`);
              } else {
                outLines.push(info.value);
              }
            }
          }
          continue;
        }
        const kwInfo = keywords[name];
        if (!kwInfo) {
          await writeText(context.stderr, `locale: Cannot set LC_ALL to default locale: Unknown keyword '${name}'\n`);
          exitCode = 1;
          continue;
        }
        if (showCategoryName) outLines.push(kwInfo.category);
        if (showKeywordName) {
          outLines.push(kwInfo.quoted ? `${name}="${kwInfo.value}"` : `${name}=${kwInfo.value}`);
        } else {
          outLines.push(kwInfo.value);
        }
      }

      if (outLines.length > 0) {
        await writeText(context.stdout, `${outLines.join("\n")}\n`);
      }
      return { exitCode };
    },
  };
}

export function createLocaleCommands(options: LocaleCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createLocaleCommand(options)]);
}

export function localeCommands(options: LocaleCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLocaleCommands(options);
  return {
    name: "locale-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
