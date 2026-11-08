import { admitMermaidLimits, MermaidBudget, type MermaidDocument, type MermaidLayoutOptions, type MermaidScene, type SceneNode } from '../contracts.js';
import { resolveMermaidTheme } from '../theme.js';
import { measureLineWidth } from '../text.js';

export function* layoutGantt(document: MermaidDocument, options?: MermaidLayoutOptions): Generator<void, MermaidScene, void> {
  const budget = options?.budget ?? new MermaidBudget(admitMermaidLimits(options?.limits), options?.signal);
  const { tokens: theme, backgroundColor } = resolveMermaidTheme(options);
  const padding = options?.padding ?? theme.padding;
  const tasks = document.tasks!;
  let start = Infinity, end = -Infinity, labelWidth = 120;
  for (const task of tasks) {
    yield;
    budget.chargeWork(1);
    start = Math.min(start, task.start);
    end = Math.max(end, task.end);
  }
  const labels = new Map(document.nodes.map(node => [node.id, node]));
  const groups = new Map(document.groups.map(group => [group.id, group.label]));
  for (const node of document.nodes) {
    yield;
    budget.chargeWork(node.label.length);
    labelWidth = Math.max(labelWidth, measureLineWidth(node.label, 13, 'ui', 400) + 16);
  }
  const plotX = padding + labelWidth + 32;
  const plotWidth = 600;
  const width = plotX + plotWidth + padding + 8;
  const nodes: SceneNode[] = [];
  const addText = (id: string, text: string, x: number, y: number, available: number, align: 'left' | 'center' | 'right' = 'left'): void => {
    nodes.push({ id, shape: 'rect', x, y, width: available, height: 24, rx: 0, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, shadow: false, dividers: [], badges: [],
      lines: [{ text, width: measureLineWidth(text, 13, 'ui', 400), x: align === 'left' ? x : align === 'right' ? x + available : x + available / 2, y: y + 17, color: theme.text, fontSize: 13, fontWeight: 400, fontFamily: 'ui', align }] });
  };
  const timeLabel = (time: number): string => new Date(time).toISOString().slice(0, end - start < 86400000 ? 19 : 10);
  addText('gantt_start', timeLabel(start), plotX, padding, plotWidth / 2 - 16);
  addText('gantt_end', timeLabel(end), plotX + plotWidth / 2 + 16, padding, plotWidth / 2 - 16, 'right');
  let y = padding + 48;
  let previousGroup: string | undefined;
  for (const task of tasks) {
    yield;
    budget.chargeWork(1);
    const node = labels.get(task.id)!;
    if (node.groupId && node.groupId !== previousGroup) {
      addText(`heading_${node.groupId}`, groups.get(node.groupId)!, padding, y, width - padding * 2);
      y += 48;
    }
    previousGroup = node.groupId;
    addText(`label_${task.id}`, node.label, padding, y, labelWidth);
    const span = Math.max(1, end - start);
    const x = plotX + (task.start - start) / span * plotWidth;
    const barWidth = task.milestone ? 16 : Math.max(1, (task.end - task.start) / span * plotWidth);
    const fill = task.status?.includes('crit') ? '#dc2626' : task.status?.includes('done') ? '#64748b' : theme.accent;
    nodes.push({ id: task.id, shape: task.milestone ? 'diamond' : 'rect', x: task.milestone ? x - 8 : x, y, width: barWidth, height: 24, rx: 3, fill, stroke: theme.border, strokeWidth: 1, shadow: false, dividers: [], badges: [], lines: [] });
    const schedule = `${timeLabel(task.start)} → ${timeLabel(task.end)}${task.status ? ` · ${task.status}` : ''}`;
    addText(`schedule_${task.id}`, schedule, plotX, y + 48, plotWidth);
    y += 96;
  }
  const height = y + padding;
  return { family: 'gantt', direction: 'LR', width, height, viewBox: { x: 0, y: 0, width, height }, naturalBounds: { width, height }, padding, theme, backgroundColor, title: document.title, nodes, groups: [], edges: [], notes: [], lifelines: [], activations: [] };
}
