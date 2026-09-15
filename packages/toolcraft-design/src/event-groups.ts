import { fitToWidth } from "./explorer/render/text.js";
import { limitOutputPreview } from "./dashboard/output-preview.js";

export interface GroupEvent { id: string; text: string; error?: boolean }
export interface EventGroupRow extends GroupEvent { groupId: string; header?: boolean; expanded?: boolean }
export function createEventGroups({ capacity, children }: { capacity: number; children: number }) {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(children) || children < 1) throw new RangeError("positive capacities required");
  const groups = new Map<string, { events: Map<string, GroupEvent>; expanded: boolean }>();
  return {
    append(groupId: string, event: GroupEvent): void {
      let group = groups.get(groupId);
      if (!group) { group = { events: new Map(), expanded: false }; groups.set(groupId, group); }
      group.events.set(event.id, { ...event, text: limitOutputPreview(event.text) });
      if (group.events.size > children) group.events.delete(group.events.keys().next().value!);
      if (event.error) group.expanded = true;
      if (groups.size > capacity) groups.delete(groups.keys().next().value!);
    },
    toggle(groupId: string): void { const group = groups.get(groupId); if (group) group.expanded = !group.expanded; },
    rows(offset: number, height: number): EventGroupRow[] {
      const result: EventGroupRow[] = []; let index = 0;
      for (const [groupId, group] of groups) {
        if (index++ >= offset) result.push({ id: groupId, text: groupId, groupId, header: true, expanded: group.expanded });
        if (result.length >= height) break;
        if (group.expanded) for (const event of group.events.values()) {
          if (index++ >= offset) result.push({ ...event, groupId });
          if (result.length >= height) break;
        }
        if (result.length >= height) break;
      }
      return height > 0 ? result : [];
    }
  };
}

export function renderEventGroupRows(rows: readonly EventGroupRow[], width: number): string[] {
  return rows.map(row => fitToWidth(`${row.header ? row.expanded ? "▾" : "▸" : row.error ? "  ■" : "  │"} ${row.text}`, width));
}
