import { fitToWidth } from "./explorer/render/text.js";
export interface TaskNode { id: string; parentId?: string; label: string; status: "pending" | "running" | "success" | "error"; durationMs?: number }
export function createTaskTree({ capacity = 10000 }: { capacity?: number } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("positive capacity required");
  const nodes = new Map<string, TaskNode>();
  const children = new Map<string | undefined, Set<string>>();
  const collapsed = new Set<string>();
  return {
    upsert(node: TaskNode): void {
      if (!nodes.has(node.id) && nodes.size >= capacity) throw new RangeError("Task capacity exceeded");
      let parent = node.parentId;
      const seen = new Set([node.id]);
      while (parent !== undefined) { if (seen.has(parent)) throw new Error("Task cycle"); seen.add(parent); parent = nodes.get(parent)?.parentId; }
      const previous = nodes.get(node.id);
      if (previous) children.get(previous.parentId)?.delete(node.id);
      nodes.set(node.id, { ...node });
      let siblings = children.get(node.parentId);
      if (!siblings) { siblings = new Set(); children.set(node.parentId, siblings); }
      siblings.add(node.id);
    },
    remove(id: string): void {
      const node = nodes.get(id);
      if (!node) return;
      children.get(node.parentId)?.delete(id);
      const pending = [id];
      while (pending.length) {
        const current = pending.pop()!;
        for (const child of children.get(current) ?? []) pending.push(child);
        children.delete(current); nodes.delete(current); collapsed.delete(current);
      }
    },
    toggle(id: string): void { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); },
    rows(offset: number, height: number): (TaskNode & { depth: number; collapsed: boolean })[] {
      const result: (TaskNode & { depth: number; collapsed: boolean })[] = [];
      const stack = [{ iterator: (children.get(undefined) ?? new Set<string>()).values(), depth: 0 }];
      let index = 0;
      while (stack.length && result.length < height) {
        const frame = stack[stack.length - 1]!;
        const next = frame.iterator.next();
        if (next.done) { stack.pop(); continue; }
        const node = nodes.get(next.value)!;
        if (index++ >= offset) result.push({ ...node, depth: frame.depth, collapsed: collapsed.has(node.id) });
        if (!collapsed.has(node.id) && children.has(node.id)) stack.push({ iterator: children.get(node.id)!.values(), depth: frame.depth + 1 });
      }
      return result;
    }
  };
}

export function renderTaskRows(rows: readonly (TaskNode & { depth: number; collapsed: boolean })[], width: number): string[] {
  const markers = { pending: "○", running: "●", success: "✓", error: "■" };
  return rows.map(row => {
    const indent = " ".repeat(Math.min(Math.max(0, width), Math.max(0, row.depth) * 2));
    const duration = row.durationMs !== undefined && Number.isFinite(row.durationMs) ? ` · ${Math.max(0, Math.round(row.durationMs))}ms` : "";
    return fitToWidth(`${indent}${row.collapsed ? "▸" : "▾"} ${markers[row.status]} ${row.label}${duration}`, width);
  });
}
