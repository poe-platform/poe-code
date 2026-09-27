import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface CalLimits {
  readonly maxArgumentBytes: number;
  readonly maxMonths: number;
}

export interface CalCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly limits?: Partial<CalLimits> | undefined;
}

export type CalOptions = CalCommandsOptions;

export function settings(options: CalCommandsOptions = {}): CalLimits {
  const limits: CalLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? 64 * 1024,
    maxMonths: options.limits?.maxMonths ?? 1200,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const HELP_TEXT = `Usage:
 cal [options] [[[day] month] year]

Display a calendar, or some part of it.

Options:
 -1, --one             show only a single month (default)
 -3, --three           show three months spanning the date
 -n, --months <num>    show num months starting with date's month
 -S, --span            span the date when displaying multiple months
 -s, --sunday          Sunday as first day of week (default)
 -M, --monday          Monday as first day of week
 -j, --julian          use day-of-year (Julian) numbering
 -y, --year            show whole current year
 -m, --month <month>   show specified month
 -w, --week[=<num>]    show US or ISO-8601 week numbers
 -h, --no-highlight    turn off highlighting of today
     --help            display this help
     --version         display version
`;

const VERSION_TEXT = `cal (Sandbox VFS-ish/GNU util-linux) 2.40
`;

function parseMonthSpec(spec: string): number | undefined {
  if (/^\d+$/.test(spec)) {
    const n = Number(spec);
    return n >= 1 && n <= 12 ? n : undefined;
  }
  const lower = spec.toLowerCase();
  if (lower.length < 3) return undefined;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const m = MONTH_NAMES[i]!.toLowerCase();
    if (m === lower || m.startsWith(lower)) return i + 1;
  }
  return undefined;
}

function isLeapYear(year: number, julianReform = true): boolean {
  if (julianReform && year <= 1752) {
    return year % 4 === 0;
  }
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const table = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1]!;
}

// Returns day of week 0=Sun..6=Sat for (year, month 1..12, day 1..31) with 1752 reform
function dayOfWeek(year: number, month: number, day: number): number {
  // For dates after Sep 14, 1752 use Gregorian Sakamoto; for dates on/before Sep 2, 1752 use Julian
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = year;
  if (month < 3) y -= 1;
  if (year > 1752 || (year === 1752 && (month > 9 || (month === 9 && day >= 14)))) {
    return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1]! + day) % 7;
  }
  return (y + Math.floor(y / 4) + t[month - 1]! + day + 5) % 7;
}

function dayOfYear(year: number, month: number, day: number): number {
  let total = 0;
  for (let m = 1; m < month; m++) {
    if (year === 1752 && m === 9) {
      total += 19;
    } else {
      total += daysInMonth(year, m);
    }
  }
  if (year === 1752 && month === 9 && day >= 14) {
    return total + (day - 11);
  }
  return total + day;
}

function centerText(text: string, width: number): string {
  const padTotal = Math.max(0, width - text.length);
  const left = Math.floor(padTotal / 2);
  return " ".repeat(left) + text;
}

function renderMonthGrid(
  year: number,
  month: number,
  options: { mondayFirst: boolean; julian: boolean; includeYearInHeader: boolean }
): { header: string; dayHeader: string; weeks: string[] } {
  const cellWidth = options.julian ? 3 : 2;
  const gridWidth = cellWidth * 7 + 6;
  const title = options.includeYearInHeader ? `${MONTH_NAMES[month - 1]} ${year}` : MONTH_NAMES[month - 1]!;
  const header = centerText(title, gridWidth);
  const sunDays = options.julian
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const orderedDays = options.mondayFirst ? [...sunDays.slice(1), sunDays[0]!] : sunDays;
  const dayHeader = orderedDays.join(" ");

  const days: number[] = [];
  if (year === 1752 && month === 9) {
    days.push(1, 2);
    for (let d = 14; d <= 30; d++) days.push(d);
  } else {
    const dim = daysInMonth(year, month);
    for (let d = 1; d <= dim; d++) days.push(d);
  }

  const firstDow = dayOfWeek(year, month, days[0]!);
  const startCol = options.mondayFirst ? (firstDow + 6) % 7 : firstDow;

  const weeks: string[] = [];
  let currentCells: string[] = Array.from({ length: startCol }, () => " ".repeat(cellWidth));

  for (const d of days) {
    const num = options.julian ? dayOfYear(year, month, d) : d;
    currentCells.push(String(num).padStart(cellWidth, " "));
    if (currentCells.length === 7) {
      weeks.push(currentCells.join(" "));
      currentCells = [];
    }
  }
  if (currentCells.length > 0) {
    while (currentCells.length < 7) currentCells.push(" ".repeat(cellWidth));
    weeks.push(currentCells.join(" "));
  }
  while (weeks.length < 6) {
    weeks.push(" ".repeat(gridWidth));
  }

  return { header, dayHeader, weeks };
}

export function createCalCommand(options: CalCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const sharedEncoder = new TextEncoder();
  return {
    name: "cal",
    description: "Display a calendar",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += sharedEncoder.encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "cal: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let mondayFirst = false;
      let julian = false;
      let wholeYear = false;
      let spanMonths = 1;
      let spanAround = false;
      let explicitMonth: number | undefined;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && arg === "--help") {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          if (arg === "--one") spanMonths = 1;
          else if (arg === "--three") {
            spanMonths = 3;
            spanAround = true;
          } else if (arg === "--sunday") mondayFirst = false;
          else if (arg === "--monday") mondayFirst = true;
          else if (arg === "--julian") julian = true;
          else if (arg === "--year") wholeYear = true;
          else if (arg === "--span") spanAround = true;
          else if (arg === "--no-highlight" || arg === "--iso") {
            // accepted
          } else if (arg.startsWith("--months=") || arg === "--months") {
            const val = arg === "--months" ? context.args[++i] : arg.slice("--months=".length);
            const n = Number(val);
            if (!val || !Number.isSafeInteger(n) || n < 1 || n > limits.maxMonths) {
              await writeText(context.stderr, `cal: invalid month count '${val ?? ""}'\n`);
              return { exitCode: 1 };
            }
            spanMonths = n;
          } else if (arg.startsWith("--month=") || arg === "--month") {
            const val = arg === "--month" ? context.args[++i] : arg.slice("--month=".length);
            const m = val ? parseMonthSpec(val) : undefined;
            if (m === undefined) {
              await writeText(context.stderr, `cal: '${val ?? ""}' is neither a month number (1..12) nor a name\n`);
              return { exitCode: 1 };
            }
            explicitMonth = m;
          } else {
            await writeText(context.stderr, `cal: unrecognized option '${arg}'\n`);
            return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "1":
                spanMonths = 1;
                break;
              case "3":
                spanMonths = 3;
                spanAround = true;
                break;
              case "s":
                mondayFirst = false;
                break;
              case "M":
                mondayFirst = true;
                break;
              case "j":
                julian = true;
                break;
              case "y":
                wholeYear = true;
                break;
              case "S":
                spanAround = true;
                break;
              case "h":
              case "w":
                break;
              case "m": {
                const rest = arg.slice(j + 1);
                const val = rest || context.args[++i];
                const m = val ? parseMonthSpec(val) : undefined;
                if (m === undefined) {
                  await writeText(context.stderr, `cal: '${val ?? ""}' is neither a month number (1..12) nor a name\n`);
                  return { exitCode: 1 };
                }
                explicitMonth = m;
                j = arg.length;
                break;
              }
              case "n": {
                const rest = arg.slice(j + 1);
                const val = rest || context.args[++i];
                const n = Number(val);
                if (!val || !Number.isSafeInteger(n) || n < 1 || n > limits.maxMonths) {
                  await writeText(context.stderr, `cal: invalid month count '${val ?? ""}'\n`);
                  return { exitCode: 1 };
                }
                spanMonths = n;
                j = arg.length;
                break;
              }
              default:
                await writeText(context.stderr, `cal: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      const now = options.clock
        ? options.clock()
        : context.env.SOURCE_DATE_EPOCH && /^\d+$/.test(context.env.SOURCE_DATE_EPOCH)
          ? new Date(Number(context.env.SOURCE_DATE_EPOCH) * 1000)
          : new Date();

      let year = now.getUTCFullYear();
      let month = explicitMonth ?? (now.getUTCMonth() + 1);

      if (operands.length === 1) {
        const y = Number(operands[0]);
        if (!/^\d+$/.test(operands[0]!) || y < 1 || y > 9999) {
          await writeText(context.stderr, `cal: not a valid year ${operands[0]}\n`);
          return { exitCode: 1 };
        }
        year = y;
        if (explicitMonth === undefined) {
          wholeYear = true;
        }
      } else if (operands.length === 2) {
        const m = parseMonthSpec(operands[0]!);
        if (m === undefined) {
          await writeText(context.stderr, `cal: '${operands[0]}' is neither a month number (1..12) nor a name\n`);
          return { exitCode: 1 };
        }
        const y = Number(operands[1]);
        if (!/^\d+$/.test(operands[1]!) || y < 1 || y > 9999) {
          await writeText(context.stderr, `cal: not a valid year ${operands[1]}\n`);
          return { exitCode: 1 };
        }
        month = m;
        year = y;
      } else if (operands.length === 3) {
        const m = parseMonthSpec(operands[1]!);
        const y = Number(operands[2]);
        if (m === undefined || !/^\d+$/.test(operands[2]!) || y < 1 || y > 9999) {
          await writeText(context.stderr, "cal: invalid date arguments\n");
          return { exitCode: 1 };
        }
        month = m;
        year = y;
      } else if (operands.length > 3) {
        await writeText(context.stderr, "cal: too many arguments\n");
        return { exitCode: 1 };
      }

      const gridWidth = julian ? 27 : 20;
      const perRow = julian ? 2 : 3;

      if (wholeYear) {
        const totalRowWidth = gridWidth * perRow + (perRow - 1) * 2;
        const lines: string[] = [centerText(String(year), totalRowWidth), ""];
        for (let startM = 1; startM <= 12; startM += perRow) {
          const rowMonths = [];
          for (let k = 0; k < perRow && startM + k <= 12; k++) {
            rowMonths.push(renderMonthGrid(year, startM + k, { mondayFirst, julian, includeYearInHeader: false }));
          }
          lines.push(rowMonths.map(g => g.header.padEnd(gridWidth, " ")).join("  ").trimEnd());
          lines.push(rowMonths.map(g => g.dayHeader).join("  "));
          for (let w = 0; w < 6; w++) {
            lines.push(rowMonths.map(g => g.weeks[w]!).join("  ").trimEnd());
          }
          if (startM + perRow <= 12) lines.push("");
        }
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      let startYear = year;
      let startMonth = month;
      if (spanAround && spanMonths > 1) {
        const offset = Math.floor((spanMonths - 1) / 2);
        const totalMonths = startYear * 12 + (startMonth - 1) - offset;
        startYear = Math.floor(totalMonths / 12);
        startMonth = (totalMonths % 12) + 1;
      }

      if (spanMonths === 1) {
        const g = renderMonthGrid(startYear, startMonth, { mondayFirst, julian, includeYearInHeader: true });
        const lines = [g.header.trimEnd(), g.dayHeader, ...g.weeks.map(w => w.trimEnd())];
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      const grids = [];
      let curY = startYear;
      let curM = startMonth;
      for (let idx = 0; idx < spanMonths; idx++) {
        grids.push(renderMonthGrid(curY, curM, { mondayFirst, julian, includeYearInHeader: true }));
        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }

      const lines: string[] = [];
      for (let r = 0; r < grids.length; r += perRow) {
        const slice = grids.slice(r, r + perRow);
        lines.push(slice.map(g => g.header.padEnd(gridWidth, " ")).join("  ").trimEnd());
        lines.push(slice.map(g => g.dayHeader).join("  "));
        for (let w = 0; w < 6; w++) {
          lines.push(slice.map(g => g.weeks[w]!).join("  ").trimEnd());
        }
        if (r + perRow < grids.length) lines.push("");
      }

      await writeText(context.stdout, `${lines.join("\n")}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createNcalCommand(options: CalCommandsOptions = {}): CommandDefinition {
  const base = createCalCommand(options);
  return {
    ...base,
    name: "ncal"
  };
}

export function createCalCommands(options: CalCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createCalCommand(options), createNcalCommand(options)]);
}

export function calCommands(options: CalCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCalCommands(options);
  return {
    name: "cal-commands",
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
