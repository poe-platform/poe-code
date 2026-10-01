import { MermaidError, type MermaidBudget, type MermaidDocument } from '../contracts.js';
import { type ScannedStatement } from '../scanner.js';
import { CoreDocument } from './core-document.js';

const day = 86_400_000;
function dateValue(raw: string): number | undefined {
  const parts = raw.split('-');
  if (parts.length !== 3 || parts[0]!.length !== 4 || parts[1]!.length !== 2 || parts[2]!.length !== 2) return undefined;
  if (parts.some(part => [...part].some(ch => ch < '0' || ch > '9'))) return undefined;
  const [year, month, date] = parts.map(Number);
  const value = new Date(`${raw}T00:00:00Z`).getTime();
  const parsed = new Date(value);
  return Number.isFinite(value) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === date ? value : undefined;
}

function duration(raw: string): number | undefined {
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: day, w: 7 * day };
  let index = 0;
  while (index < raw.length && ((raw[index]! >= '0' && raw[index]! <= '9') || raw[index] === '.')) index++;
  const unit = units[raw.slice(index)];
  if (!index || !unit) return undefined;
  const value = Number(raw.slice(0, index)) * unit;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function* parseGantt(statements: readonly ScannedStatement[], budget: MermaidBudget): Generator<void, MermaidDocument, void> {
  const document = new CoreDocument('gantt', budget);
  const tasks: NonNullable<MermaidDocument['tasks']>[number][] = [];
  const byId = new Map<string, NonNullable<MermaidDocument['tasks']>[number]>();
  for (const statement of statements.slice(1)) {
    yield;
    if (document.heading(statement)) continue;
    if (statement.text.startsWith('dateFormat ')) {
      if (statement.text.slice(11).trim() !== 'YYYY-MM-DD') throw new MermaidError('E_UNSUPPORTED', 'Gantt dateFormat supports YYYY-MM-DD', { span: statement });
      continue;
    }
    const colon = statement.text.indexOf(':');
    if (colon < 1) throw new MermaidError('E_SYNTAX', 'Gantt task requires a label and schedule', { span: statement });
    const label = statement.text.slice(0, colon).trim();
    const fields = statement.text.slice(colon + 1).split(',').map(value => value.trim());
    const tags: string[] = [];
    while (['done', 'active', 'crit', 'milestone'].includes(fields[0]!)) tags.push(fields.shift()!);
    let id: string | undefined;
    if (fields.length === 3 || (fields.length === 2 && dateValue(fields[0]!) === undefined && !fields[0]!.startsWith('after '))) id = fields.shift();
    if (fields.length < 1 || fields.length > 2 || fields.some(field => !field)) throw new MermaidError('E_SYNTAX', 'Invalid Gantt schedule', { span: statement });
    let start: number | undefined;
    if (fields.length === 2) {
      const raw = fields.shift()!;
      if (raw.startsWith('after ')) {
        const dependencies = raw.slice(6).split(' ').filter(Boolean);
        if (!dependencies.length || dependencies.some(dependency => !byId.has(dependency))) throw new MermaidError('E_SYNTAX', 'Unknown Gantt dependency', { span: statement });
        start = Math.max(...dependencies.map(dependency => byId.get(dependency)!.end));
      } else start = dateValue(raw);
    } else start = tasks.at(-1)?.end;
    const rawEnd = fields[0]!;
    const length = duration(rawEnd);
    const end = length === undefined ? dateValue(rawEnd) : start === undefined ? undefined : start + length;
    if (start === undefined || end === undefined || end < start || !Number.isFinite(end) || Math.abs(end) > 8.64e15) throw new MermaidError('E_SYNTAX', 'Gantt requires valid dates, dependencies, and nonnegative durations', { span: statement });
    const nodeId = document.node(label, statement, 'rect', id);
    const task = { id: nodeId, start, end, milestone: tags.includes('milestone'), status: tags.join(', ') || undefined };
    tasks.push(task);
    byId.set(nodeId, task);
  }
  return { ...document.finish(), tasks };
}
