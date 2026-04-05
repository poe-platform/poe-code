export interface SseEvent {
  data: string;
  id?: string;
  event?: string;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export function formatSseEvent(event: SseEvent): string {
  const lines: string[] = [];

  if (event.id !== undefined) {
    lines.push(`id: ${event.id}`);
  }

  if (event.event !== undefined) {
    lines.push(`event: ${event.event}`);
  }

  const dataLines = event.data
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");

  for (const dataLine of dataLines) {
    lines.push(`data: ${dataLine}`);
  }

  return `${lines.join("\n")}\n\n`;
}
