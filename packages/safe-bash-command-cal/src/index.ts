import { yieldTurn } from "safe-bash-contracts/yield";
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
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
    maxMonths: options.limits?.maxMonths ?? Infinity,
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
 -b                    use oldstyle cal output for ncal
 -C                    switch to cal mode
 -N                    switch to ncal mode
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

function parseDateSpec(spec: string): { year: number; month: number } | undefined {
  const m = /^(\d{1,4})-(\d{1,2})(?:-\d{1,2})?$/.exec(spec);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return undefined;
  return { year, month };
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

function isoWeekNumber(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCFullYear(year);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  yearStart.setUTCFullYear(d.getUTCFullYear());
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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
  const sunDays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const orderedDays = options.mondayFirst ? [...sunDays.slice(1), sunDays[0]!] : sunDays;
  const dayHeader = orderedDays.map((d) => d.padStart(cellWidth, " ")).join(" ");

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
  let row: string[] = Array.from({ length: startCol }, () => " ".repeat(cellWidth));

  for (const d of days) {
    const val = options.julian ? dayOfYear(year, month, d) : d;
    row.push(String(val).padStart(cellWidth, " "));
    if (row.length === 7) {
      weeks.push(row.join(" ").padEnd(gridWidth, " "));
      row = [];
    }
  }
  if (row.length > 0) {
    while (row.length < 7) row.push(" ".repeat(cellWidth));
    weeks.push(row.join(" ").padEnd(gridWidth, " "));
  }
  while (weeks.length < 6) {
    weeks.push(" ".repeat(gridWidth));
  }

  return { header, dayHeader, weeks };
}

function renderVerticalNcalMonth(
  year: number,
  month: number,
  options: { mondayFirst: boolean; julian: boolean; includeYearInHeader: boolean; showWeeks: boolean }
): string[] {
  const cellWidth = options.julian ? 3 : 2;
  const title = options.includeYearInHeader ? `${MONTH_NAMES[month - 1]} ${year}` : MONTH_NAMES[month - 1]!;
  const header = (" " + centerText(title, 19)).padEnd(22, " ");
  const sunDays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const orderedDays = options.mondayFirst ? [...sunDays.slice(1), sunDays[0]!] : sunDays;

  const days: number[] = [];
  if (year === 1752 && month === 9) {
    days.push(1, 2);
    for (let d = 14; d <= 30; d++) days.push(d);
  } else {
    const dim = daysInMonth(year, month);
    for (let d = 1; d <= dim; d++) days.push(d);
  }

  const firstDow = dayOfWeek(year, month, days[0]!);
  const startRow = options.mondayFirst ? (firstDow + 6) % 7 : firstDow;

  const cols: (number | undefined)[][] = [];
  let curCol: (number | undefined)[] = Array.from({ length: 7 }, () => undefined);
  let r = startRow;
  for (const d of days) {
    curCol[r] = d;
    r++;
    if (r === 7) {
      cols.push(curCol);
      curCol = Array.from({ length: 7 }, () => undefined);
      r = 0;
    }
  }
  if (r > 0) {
    cols.push(curCol);
  }
  while (cols.length < 6) {
    cols.push(Array.from({ length: 7 }, () => undefined));
  }

  const lines: string[] = [header];
  for (let rowIdx = 0; rowIdx < 7; rowIdx++) {
    let line = orderedDays[rowIdx]!;
    for (let c = 0; c < 6; c++) {
      const d = cols[c]![rowIdx];
      if (d === undefined) {
        line += " ".repeat(cellWidth + 1);
      } else {
        const val = options.julian ? dayOfYear(year, month, d) : d;
        line += " " + String(val).padStart(cellWidth, " ");
      }
    }
    lines.push(line);
  }

  if (options.showWeeks) {
    let weekLine = "  ";
    for (let c = 0; c < 6; c++) {
      const colDays: number[] = []; for (const x of cols[c]!) { if (x !== undefined) colDays.push(x); }
      if (colDays.length === 0) {
        weekLine += " ".repeat(cellWidth + 1);
      } else {
        const refDay = colDays[colDays.length - 1]!;
        const wn = isoWeekNumber(year, month, refDay);
        weekLine += " " + String(wn).padStart(cellWidth, " ");
      }
    }
    lines.push(weekLine);
  }

  return lines;
}

export function createCalCommand(options: CalCommandsOptions = {}): CommandDefinition {
  const lim = settings(options);
  return {
    name: "cal",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const rawArgs = context.args;
      let totalArgBytes = 0;
      for (const a of rawArgs) {
        totalArgBytes += a.length;
        if (totalArgBytes > lim.maxArgumentBytes) {
          await writeText(context.stderr, "cal: argument list too long\n");
          return { exitCode: 1 };
        }
      }

      const isNcalDefault = context.command === "ncal";
      let verticalLayout = isNcalDefault;
      let mondayFirst = isNcalDefault;
      let julian = false;
      let wholeYear = false;
      let spanMonths = 1;
      let spanAround = false;
      let showWeeks = false;
      let explicitMonth: number | undefined;
      let explicitYear: number | undefined;
      let afterMonths = 0;
      let beforeMonths = 0;
      const operands: string[] = [];

      for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i]!;
        if (arg === "--") {
          operands.push(...rawArgs.slice(i + 1));
          break;
        }
        if (arg === "--help") {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (arg === "--version") {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (arg === "--one" || arg === "-1") {
          spanMonths = 1;
          spanAround = false;
        } else if (arg === "--three" || arg === "-3") {
          spanMonths = 3;
          spanAround = true;
        } else if (arg === "--sunday" || arg === "-s") {
          mondayFirst = false;
        } else if (arg === "--monday" || arg === "-M") {
          mondayFirst = true;
        } else if (arg === "-b" || arg === "-C") {
          verticalLayout = false;
          mondayFirst = false;
        } else if (arg === "-N") {
          verticalLayout = true;
          mondayFirst = true;
        } else if (arg === "--julian" || arg === "-j") {
          julian = true;
        } else if (arg === "--year" || arg === "-y") {
          wholeYear = true;
        } else if (arg === "--span" || arg === "-S") {
          if (isNcalDefault && verticalLayout) {
            mondayFirst = false;
          } else {
            spanAround = true;
          }
        } else if (arg === "--no-highlight" || arg === "-h" || arg === "-J") {
          // Accepted
        } else if (arg === "--week" || arg.startsWith("--week=") || arg === "-w") {
          showWeeks = true;
        } else if (arg === "-m" || arg === "--month" || arg.startsWith("--month=")) {
          const val = arg.startsWith("--month=") ? arg.slice(8) : rawArgs[++i];
          if (!val) {
            await writeText(context.stderr, "cal: option requires an argument -- 'm'\n");
            return { exitCode: 1 };
          }
          const m = parseMonthSpec(val);
          if (m === undefined) {
            await writeText(context.stderr, `cal: '${val}' is neither a month number (1..12) nor a name\n`);
            return { exitCode: 1 };
          }
          explicitMonth = m;
        } else if (arg === "-n" || arg === "--months" || arg.startsWith("--months=")) {
          const val = arg.startsWith("--months=") ? arg.slice(9) : rawArgs[++i];
          const n = Number(val);
          if (!val || !Number.isSafeInteger(n) || n < 1 || n > lim.maxMonths) {
            await writeText(context.stderr, `cal: invalid month count '${val ?? ""}'\n`);
            return { exitCode: 1 };
          }
          spanMonths = n;
        } else if (arg === "-d" || arg === "--date" || arg.startsWith("--date=")) {
          const val = arg.startsWith("--date=") ? arg.slice(7) : rawArgs[++i];
          const ds = val ? parseDateSpec(val) : undefined;
          if (!ds) {
            await writeText(context.stderr, `cal: invalid date '${val ?? ""}'\n`);
            return { exitCode: 1 };
          }
          explicitYear = ds.year;
          explicitMonth = ds.month;
        } else if (arg === "-A" || arg === "-B") {
          const val = rawArgs[++i];
          const count = Number(val);
          if (!val || !Number.isSafeInteger(count) || count < 0) {
            await writeText(context.stderr, `cal: invalid month count '${val ?? ""}'\n`);
            return { exitCode: 1 };
          }
          if (arg === "-A") afterMonths = count;
          else beforeMonths = count;
        } else if (arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "1") { spanMonths = 1; spanAround = false; }
            else if (ch === "3") { spanMonths = 3; spanAround = true; }
            else if (ch === "s") mondayFirst = false;
            else if (ch === "M") mondayFirst = true;
            else if (ch === "b" || ch === "C") { verticalLayout = false; mondayFirst = false; }
            else if (ch === "N") { verticalLayout = true; mondayFirst = true; }
            else if (ch === "j") julian = true;
            else if (ch === "y") wholeYear = true;
            else if (ch === "S") {
              if (isNcalDefault && verticalLayout) mondayFirst = false;
              else spanAround = true;
            }
            else if (ch === "h" || ch === "J") { /* ignore */ }
            else if (ch === "w") { showWeeks = true; }
            else if (ch === "m") {
              const rest = arg.slice(j + 1) || rawArgs[++i];
              if (!rest) {
                await writeText(context.stderr, "cal: option requires an argument -- 'm'\n");
                return { exitCode: 1 };
              }
              const m = parseMonthSpec(rest);
              if (m === undefined) {
                await writeText(context.stderr, `cal: '${rest}' is neither a month number (1..12) nor a name\n`);
                return { exitCode: 1 };
              }
              explicitMonth = m;
              break;
            } else if (ch === "n") {
              const rest = arg.slice(j + 1) || rawArgs[++i];
              const n = Number(rest);
              if (!rest || !Number.isSafeInteger(n) || n < 1 || n > lim.maxMonths) {
                await writeText(context.stderr, `cal: invalid month count '${rest ?? ""}'\n`);
                return { exitCode: 1 };
              }
              spanMonths = n;
              break;
            } else if (ch === "A" || ch === "B") {
              const rest = arg.slice(j + 1) || rawArgs[++i];
              const count = Number(rest);
              if (!rest || !Number.isSafeInteger(count) || count < 0) {
                await writeText(context.stderr, `cal: invalid month count '${rest ?? ""}'\n`);
                return { exitCode: 1 };
              }
              if (ch === "A") afterMonths = count;
              else beforeMonths = count;
              break;
            } else if (ch === "d") {
              const rest = arg.slice(j + 1) || rawArgs[++i];
              const ds = rest ? parseDateSpec(rest) : undefined;
              if (!ds) {
                await writeText(context.stderr, `cal: invalid date '${rest ?? ""}'\n`);
                return { exitCode: 1 };
              }
              explicitYear = ds.year;
              explicitMonth = ds.month;
              break;
            } else {
              await writeText(context.stderr, `cal: invalid option -- '${ch}'\n`);
              return { exitCode: 1 };
            }
          }
        } else {
          operands.push(arg);
        }
      }

      if (afterMonths > 0 || beforeMonths > 0) {
        spanMonths = beforeMonths + 1 + afterMonths;
      }

      const epoch = context.env.SOURCE_DATE_EPOCH;
      const now = options.clock ? options.clock() : epoch !== undefined ? new Date(Number(epoch) * 1000) : new Date();
      let year = explicitYear ?? now.getUTCFullYear();
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

      const count = wholeYear ? 12 : spanMonths;
      if (!Number.isSafeInteger(count) || count > lim.maxMonths) {
        await writeText(context.stderr, "cal: month count exceeds size limit\n");
        return { exitCode: 1 };
      }

      const gridWidth = julian ? 27 : 20;
      const perRow = julian ? 2 : 3;

      if (verticalLayout) {
        const offset = wholeYear ? 0 : beforeMonths || (spanAround ? Math.floor((spanMonths - 1) / 2) : 0);
        const first = year * 12 + (wholeYear ? 0 : month - 1) - offset;
        const grids = [];
        for (let index = 0; index < count; index++) {
          await yieldTurn(context.signal);
          const total = first + index;
          grids.push(renderVerticalNcalMonth(Math.floor(total / 12), ((total % 12) + 12) % 12 + 1, {
            mondayFirst, julian, includeYearInHeader: !wholeYear, showWeeks,
          }));
        }
        const verticalPerRow = wholeYear ? (julian ? 3 : 4) : perRow;
        const lines: string[] = wholeYear ? [centerText(String(year), (julian ? 26 : 22) * verticalPerRow)] : [];
        for (let start = 0; start < grids.length; start += verticalPerRow) {
          await yieldTurn(context.signal);
          const group = grids.slice(start, start + verticalPerRow);
          for (let line = 0; line < group[0]!.length; line++) {
            lines.push(group.map((grid, index) => {
              const text = line === 0 || index === 0 ? grid[line]! : "  " + grid[line]!.slice(2);
              return text.padEnd(julian ? 26 : 22);
            }).join(""));
          }
          if (start + verticalPerRow < grids.length) lines.push("");
        }
        // Preserve the established single-month spacing.
        await writeText(context.stdout, `${(count === 1 && !wholeYear ? grids[0]! : lines).join("\n")}\n`);
        return { exitCode: 0 };
      }

      if (wholeYear) {
        const lines: string[] = [`${" ".repeat(28)}${year}`];
        for (let startM = 1; startM <= 12; startM += perRow) {
          await yieldTurn(context.signal);
          const rowMonths = [];
          for (let k = 0; k < perRow && startM + k <= 12; k++) {
            rowMonths.push(renderMonthGrid(year, startM + k, { mondayFirst, julian, includeYearInHeader: false }));
          }
          lines.push(rowMonths.map(g => g.header.padEnd(gridWidth, " ")).join("  ") + "  ");
          lines.push(rowMonths.map(g => g.dayHeader.padEnd(gridWidth, " ")).join("  ") + "  ");
          for (let w = 0; w < 6; w++) {
            lines.push(rowMonths.map(g => g.weeks[w]!).join("  ") + "  ");
          }
          if (startM + perRow <= 12) lines.push("");
        }
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      let startYear = year;
      let startMonth = month;
      if (beforeMonths > 0) {
        const totalMonths = startYear * 12 + (startMonth - 1) - beforeMonths;
        startYear = Math.floor(totalMonths / 12);
        startMonth = ((totalMonths % 12) + 12) % 12 + 1;
      } else if (spanAround && spanMonths > 1) {
        const offset = Math.floor((spanMonths - 1) / 2);
        const totalMonths = startYear * 12 + (startMonth - 1) - offset;
        startYear = Math.floor(totalMonths / 12);
        startMonth = ((totalMonths % 12) + 12) % 12 + 1;
      }

      if (spanMonths === 1) {
        const g = renderMonthGrid(startYear, startMonth, { mondayFirst, julian, includeYearInHeader: true });
        const lines = [
          g.header.padEnd(gridWidth, " ") + "  ",
          g.dayHeader.padEnd(gridWidth, " ") + "  ",
          ...g.weeks.map(w => w.padEnd(gridWidth, " ") + "  "),
        ];
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      const grids = [];
      let curY = startYear;
      let curM = startMonth;
      for (let idx = 0; idx < spanMonths; idx++) {
        await yieldTurn(context.signal);
        grids.push(renderMonthGrid(curY, curM, { mondayFirst, julian, includeYearInHeader: true }));
        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }

      const lines: string[] = [];
      for (let r = 0; r < grids.length; r += perRow) {
        await yieldTurn(context.signal);
        const slice = grids.slice(r, r + perRow);
        lines.push(slice.map(g => g.header.padEnd(gridWidth, " ")).join("  ") + "  ");
        lines.push(slice.map(g => g.dayHeader.padEnd(gridWidth, " ")).join("  ") + "  ");
        for (let w = 0; w < 6; w++) {
          lines.push(slice.map(g => g.weeks[w]!).join("  ") + "  ");
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

export function evalSyncCal(
  cmdName: "cal" | "ncal",
  rawArgs: readonly string[],
  sourceDateEpoch?: string
): string | undefined {
  const isNcalDefault = cmdName === "ncal";
  let verticalLayout = isNcalDefault;
  let mondayFirst = isNcalDefault;
  let julian = false;
  let wholeYear = false;
  let spanMonths = 1;
  let spanAround = false;
  let showWeeks = false;
  let explicitMonth: number | undefined;
  let explicitYear: number | undefined;
  let afterMonths = 0;
  let beforeMonths = 0;
  const operands: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (arg === "--") {
      operands.push(...rawArgs.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "--version") return undefined;
    if (arg === "--one" || arg === "-1") { spanMonths = 1; spanAround = false; }
    else if (arg === "--three" || arg === "-3") { spanMonths = 3; spanAround = true; }
    else if (arg === "--sunday" || arg === "-s") { mondayFirst = false; }
    else if (arg === "--monday" || arg === "-M") { mondayFirst = true; }
    else if (arg === "-b" || arg === "-C") { verticalLayout = false; mondayFirst = false; }
    else if (arg === "-N") { verticalLayout = true; mondayFirst = true; }
    else if (arg === "--julian" || arg === "-j") { julian = true; }
    else if (arg === "--year" || arg === "-y") { wholeYear = true; }
    else if (arg === "--span" || arg === "-S") {
      if (isNcalDefault && verticalLayout) mondayFirst = false;
      else spanAround = true;
    }
    else if (arg === "--no-highlight" || arg === "-h" || arg === "-J") { /* ignore */ }
    else if (arg === "--week" || arg.startsWith("--week=") || arg === "-w") { showWeeks = true; }
    else if (arg === "-m" || arg === "--month" || arg.startsWith("--month=")) {
      const val = arg.startsWith("--month=") ? arg.slice(8) : rawArgs[++i];
      if (!val) return undefined;
      const m = parseMonthSpec(val);
      if (m === undefined) return undefined;
      explicitMonth = m;
    } else if (arg === "-n" || arg === "--months" || arg.startsWith("--months=")) {
      const val = arg.startsWith("--months=") ? arg.slice(9) : rawArgs[++i];
      const n = Number(val);
      if (!val || !Number.isSafeInteger(n) || n < 1 || n > 24) return undefined;
      spanMonths = n;
    } else if (arg === "-d" || arg === "--date" || arg.startsWith("--date=")) {
      const val = arg.startsWith("--date=") ? arg.slice(7) : rawArgs[++i];
      const ds = val ? parseDateSpec(val) : undefined;
      if (!ds) return undefined;
      explicitYear = ds.year;
      explicitMonth = ds.month;
    } else if (arg === "-A" || arg === "-B") {
      const val = rawArgs[++i];
      const count = Number(val);
      if (!val || !Number.isSafeInteger(count) || count < 0 || count > 24) return undefined;
      if (arg === "-A") afterMonths = count;
      else beforeMonths = count;
    } else if (arg.startsWith("-") && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j]!;
        if (ch === "1") { spanMonths = 1; spanAround = false; }
        else if (ch === "3") { spanMonths = 3; spanAround = true; }
        else if (ch === "s") mondayFirst = false;
        else if (ch === "M") mondayFirst = true;
        else if (ch === "b" || ch === "C") { verticalLayout = false; mondayFirst = false; }
        else if (ch === "N") { verticalLayout = true; mondayFirst = true; }
        else if (ch === "j") julian = true;
        else if (ch === "y") wholeYear = true;
        else if (ch === "S") {
          if (isNcalDefault && verticalLayout) mondayFirst = false;
          else spanAround = true;
        }
        else if (ch === "h" || ch === "J") { /* ignore */ }
        else if (ch === "w") { showWeeks = true; }
        else if (ch === "m") {
          const rest = arg.slice(j + 1) || rawArgs[++i];
          if (!rest) return undefined;
          const m = parseMonthSpec(rest);
          if (m === undefined) return undefined;
          explicitMonth = m;
          break;
        } else if (ch === "n") {
          const rest = arg.slice(j + 1) || rawArgs[++i];
          const n = Number(rest);
          if (!rest || !Number.isSafeInteger(n) || n < 1 || n > 24) return undefined;
          spanMonths = n;
          break;
        } else if (ch === "A" || ch === "B") {
          const rest = arg.slice(j + 1) || rawArgs[++i];
          const count = Number(rest);
          if (!rest || !Number.isSafeInteger(count) || count < 0 || count > 24) return undefined;
          if (ch === "A") afterMonths = count;
          else beforeMonths = count;
          break;
        } else if (ch === "d") {
          const rest = arg.slice(j + 1) || rawArgs[++i];
          const ds = rest ? parseDateSpec(rest) : undefined;
          if (!ds) return undefined;
          explicitYear = ds.year;
          explicitMonth = ds.month;
          break;
        } else return undefined;
      }
    } else {
      operands.push(arg);
    }
  }

  if (afterMonths > 0 || beforeMonths > 0) spanMonths = beforeMonths + 1 + afterMonths;
  const now = sourceDateEpoch !== undefined ? new Date(Number(sourceDateEpoch) * 1000) : new Date();
  let year = explicitYear ?? now.getUTCFullYear();
  let month = explicitMonth ?? (now.getUTCMonth() + 1);

  if (operands.length === 1) {
    const y = Number(operands[0]);
    if (!/^\d+$/.test(operands[0]!) || y < 1 || y > 9999) return undefined;
    year = y;
    if (explicitMonth === undefined) wholeYear = true;
  } else if (operands.length === 2) {
    const m = parseMonthSpec(operands[0]!);
    const y = Number(operands[1]);
    if (m === undefined || !/^\d+$/.test(operands[1]!) || y < 1 || y > 9999) return undefined;
    month = m;
    year = y;
  } else if (operands.length === 3) {
    const m = parseMonthSpec(operands[1]!);
    const y = Number(operands[2]);
    if (m === undefined || !/^\d+$/.test(operands[2]!) || y < 1 || y > 9999) return undefined;
    month = m;
    year = y;
  } else if (operands.length > 3) {
    return undefined;
  }

  const count = wholeYear ? 12 : spanMonths;
  if (!Number.isSafeInteger(count) || count > 24) return undefined;
  const gridWidth = julian ? 27 : 20;
  const perRow = julian ? 2 : 3;

  if (verticalLayout) {
    const offset = wholeYear ? 0 : beforeMonths || (spanAround ? Math.floor((spanMonths - 1) / 2) : 0);
    const baseMonth = wholeYear ? 0 : month - 1 - offset;
    const grids: string[][] = [];
    for (let idx = 0; idx < count; idx++) {
      const total = year * 12 + baseMonth + idx;
      grids.push(renderVerticalNcalMonth(Math.floor(total / 12), ((total % 12) + 12) % 12 + 1, {
        mondayFirst, julian, includeYearInHeader: !wholeYear, showWeeks,
      }));
    }
    const verticalPerRow = wholeYear ? (julian ? 3 : 4) : perRow;
    const lines: string[] = wholeYear ? [centerText(String(year), (julian ? 26 : 22) * verticalPerRow)] : [];
    for (let start = 0; start < grids.length; start += verticalPerRow) {
      const group = grids.slice(start, start + verticalPerRow);
      for (let line = 0; line < group[0]!.length; line++) {
        lines.push(group.map((grid, index) => {
          const text = line === 0 || index === 0 ? grid[line]! : "  " + grid[line]!.slice(2);
          return text.padEnd(julian ? 26 : 22);
        }).join(""));
      }
      if (start + verticalPerRow < grids.length) lines.push("");
    }
    return (count === 1 && !wholeYear ? grids[0]! : lines).join("\n");
  }

  if (wholeYear) {
    const lines: string[] = [`${" ".repeat(28)}${year}`];
    for (let startM = 1; startM <= 12; startM += perRow) {
      const rowMonths = [];
      for (let k = 0; k < perRow && startM + k <= 12; k++) {
        rowMonths.push(renderMonthGrid(year, startM + k, { mondayFirst, julian, includeYearInHeader: false }));
      }
      lines.push(rowMonths.map(g => g.header.padEnd(gridWidth, " ")).join("  ") + "  ");
      lines.push(rowMonths.map(g => g.dayHeader.padEnd(gridWidth, " ")).join("  ") + "  ");
      for (let w = 0; w < 6; w++) {
        lines.push(rowMonths.map(g => g.weeks[w]!).join("  ") + "  ");
      }
      if (startM + perRow <= 12) lines.push("");
    }
    return lines.join("\n");
  }

  let startYear = year;
  let startMonth = month;
  if (beforeMonths > 0) {
    const totalMonths = startYear * 12 + (startMonth - 1) - beforeMonths;
    startYear = Math.floor(totalMonths / 12);
    startMonth = ((totalMonths % 12) + 12) % 12 + 1;
  } else if (spanAround && spanMonths > 1) {
    const offset = Math.floor((spanMonths - 1) / 2);
    const totalMonths = startYear * 12 + (startMonth - 1) - offset;
    startYear = Math.floor(totalMonths / 12);
    startMonth = ((totalMonths % 12) + 12) % 12 + 1;
  }

  if (spanMonths === 1) {
    const g = renderMonthGrid(startYear, startMonth, { mondayFirst, julian, includeYearInHeader: true });
    return [
      g.header.padEnd(gridWidth, " ") + "  ",
      g.dayHeader.padEnd(gridWidth, " ") + "  ",
      ...g.weeks.map(w => w.padEnd(gridWidth, " ") + "  "),
    ].join("\n");
  }

  const grids = [];
  let curY = startYear;
  let curM = startMonth;
  for (let idx = 0; idx < spanMonths; idx++) {
    grids.push(renderMonthGrid(curY, curM, { mondayFirst, julian, includeYearInHeader: true }));
    curM++;
    if (curM > 12) { curM = 1; curY++; }
  }
  const lines: string[] = [];
  for (let r = 0; r < grids.length; r += perRow) {
    const slice = grids.slice(r, r + perRow);
    lines.push(slice.map(g => g.header.padEnd(gridWidth, " ")).join("  ") + "  ");
    lines.push(slice.map(g => g.dayHeader.padEnd(gridWidth, " ")).join("  ") + "  ");
    for (let w = 0; w < 6; w++) {
      lines.push(slice.map(g => g.weeks[w]!).join("  ") + "  ");
    }
    if (r + perRow < grids.length) lines.push("");
  }
  return lines.join("\n");
}
