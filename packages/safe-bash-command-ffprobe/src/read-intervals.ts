import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { CommandContext } from "safe-bash-contracts/command";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker, MediaProbePacket } from "@poe-code/mp4-ast";

interface ReadInterval {
  start: number | undefined;
  relativeStart: boolean;
  end: number | undefined;
  relativeEnd: boolean;
  packets: boolean;
}

export function parseReadIntervals(value: string): ReadInterval[] {
  function time(text: string): number {
    const negative = text.startsWith("-");
    if (negative) text = text.slice(1);
    let scale = 1;
    for (const [suffix, factor] of [["us", 0.000001], ["ms", 0.001], ["s", 1]] as const) {
      if (text.endsWith(suffix)) { text = text.slice(0, -suffix.length); scale = factor; break; }
    }
    const parts = text.split(":");
    if (parts.length > 3 || parts.some(part => !part || [...part].some(c => !(c >= "0" && c <= "9") && c !== ".")))
      throw new Error(`Invalid read interval time '${text}'`);
    const result = parts.reduce((total, part) => total * 60 + Number(part), 0) * scale * (negative ? -1 : 1);
    if (!Number.isFinite(result)) throw new Error(`Invalid read interval time '${text}'`);
    return result;
  }
  return value.split(",").map(interval => {
    const parts = interval.split("%");
    if (!interval || parts.length > 2) throw new Error(`Invalid read interval '${interval}'`);
    const start = parts[0]!, end = parts[1] ?? "";
    const relativeStart = start.startsWith("+"), relativeEnd = end.startsWith("+");
    const packets = end.startsWith("+#");
    const count = packets ? Number(end.slice(2)) : undefined;
    if (packets && (!end.slice(2) || [...end.slice(2)].some(c => c < "0" || c > "9") || !Number.isSafeInteger(count)))
      throw new Error(`Invalid read interval packet count '${end}'`);
    return { start: start ? time(relativeStart ? start.slice(1) : start) : undefined, relativeStart,
      end: packets ? count : end ? time(relativeEnd ? end.slice(1) : end) : undefined, relativeEnd, packets };
  });
}

/** Keep replayable packet descriptors in caller backing, with only one head per stream resident. */
export async function readPacketIntervals(
  packets: Iterable<MediaProbePacket> | AsyncIterable<MediaProbePacket>, intervals: readonly ReadInterval[],
  context: CommandContext, budget: MediaBudgetTracker, retain: (close: () => Promise<void>) => void,
  selectStreams?: string, pcm?: { sampleRate: number; blockAlign: number }
): Promise<{ packets: AsyncIterable<MediaProbePacket>; counts: Map<number, number> }> {
  const storage = new PagedStorage(context, 4);
  retain(storage.close.bind(storage));
  type Head = { position: number; next: number; packet: MediaProbePacket };
  const streams = new Map<number, { first: number; last: number; type: string; head: Head | undefined }>();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let steps = 0;
  async function checkpoint() {
    context.signal.throwIfAborted(); budget.checkCpu();
    if (++steps % 256 === 0) await yieldTurn(context.signal);
  }
  async function read(position: number): Promise<Head | undefined> {
    if (!position) return;
    await checkpoint();
    const bytes = await storage.read(position, 16), header = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return { position, next: header.getFloat64(0, true), packet: JSON.parse(decoder.decode(await storage.read(position + 16, header.getFloat64(8, true)))) as MediaProbePacket };
  }
  for await (const packet of packets) {
    await checkpoint();
    const body = encoder.encode(JSON.stringify(packet)), position = storage.allocate(16 + body.length);
    const header = new Uint8Array(16);
    new DataView(header.buffer).setFloat64(8, body.length, true);
    await storage.write(position, header); await storage.write(position + 16, body);
    const stream = streams.get(packet.stream_index);
    if (stream) {
      const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true);
      await storage.write(stream.last, link); stream.last = position;
    } else {
      budget.checkStreams(streams.size + 1);
      streams.set(packet.stream_index, { first: position, last: position, type: packet.codec_type, head: undefined });
    }
  }
  const ordered = [...streams.entries()].sort(([a], [b]) => a - b);
  const type = selectStreams?.startsWith("v") ? "video" : selectStreams?.startsWith("a") ? "audio" : selectStreams?.startsWith("s") ? "subtitle" : selectStreams?.startsWith("d") ? "data" : selectStreams?.startsWith("t") ? "attachment" : undefined;
  const candidates = type ? ordered.filter(([, stream]) => stream.type === type) : ordered;
  const selected = new Set(!selectStreams ? ordered.map(([index]) => index)
    : type ? (selectStreams.length > 2 ? candidates.slice(Number(selectStreams.slice(2)), Number(selectStreams.slice(2)) + 1) : candidates).map(([index]) => index)
    : [Number(selectStreams)]);
  const primary = ordered.find(([index, stream]) => selected.has(index) && stream.type === "video")
    ?? ordered.find(([index]) => selected.has(index));
  const counts = new Map<number, number>();
  // PCM seeks establish a new packet grid at the requested sample, even between
  // the demuxer's original packet boundaries. The payload stays in the input.
  const pcmFirst = pcm && ordered[0] ? (await read(ordered[0][1].first))!.packet : undefined;
  const pcmLast = pcm && ordered[0] ? (await read(ordered[0][1].last))!.packet : undefined;
  function pcmHead(pts: number): Head | undefined {
    if (!pcm || !pcmFirst || !pcmLast) return;
    const pos = Number(pcmFirst.pos) + pts * pcm.blockAlign;
    const remaining = Number(pcmLast.pos) + Number(pcmLast.size) - pos;
    if (remaining <= 0) return;
    const size = Math.min(Math.max(1, Math.floor(4096 / pcm.blockAlign)) * pcm.blockAlign, remaining);
    const duration = Math.floor(size / pcm.blockAlign);
    const time = (pts / pcm.sampleRate).toFixed(6);
    return { position: 0, next: 0, packet: { ...pcmFirst, pts, dts: pts, pts_time: time, dts_time: time,
      pos: String(pos), size: String(size), duration, duration_time: (duration / pcm.sampleRate).toFixed(6) } };
  }
  async function seek(stream: (typeof ordered)[number][1], target: number) {
    if (pcm) {
      stream.head = pcmHead(Math.max(0, Math.round(target * pcm.sampleRate)));
      return;
    }
    let chosen = await read(stream.first);
    for (let head = chosen; head; head = await read(head.next)) {
      if (Number(head.packet.pts_time) <= target && head.packet.flags.includes("K")) chosen = head;
    }
    stream.head = chosen;
  }
  async function* scan(): AsyncGenerator<MediaProbePacket> {
    for (const [, stream] of ordered) stream.head = pcm ? pcmHead(0) : await read(stream.first);
    let current = primary?.[1].head ? Number(primary[1].head.packet.pts_time) : 0;
    for (const interval of intervals) {
      if (interval.start !== undefined && primary) {
        await seek(primary[1], interval.start + (interval.relativeStart ? current : 0));
        const target = primary[1].head ? Number(primary[1].head.packet.dts_time) : 0;
        for (const [, stream] of ordered) if (stream !== primary[1]) await seek(stream, target);
      }
      let count = 0, end = interval.end;
      let first = true;
      while (true) {
        if (pcm) await checkpoint();
        let next: (typeof ordered)[number] | undefined;
        for (const entry of ordered) {
          if (!entry[1].head) continue;
          const packet = entry[1].head.packet, best = next?.[1].head?.packet;
          // MOV prefers physical interleaving for timestamps within one second.
          const delta = best ? Number(packet.dts_time) - Number(best.dts_time) : 0;
          if (!best || delta < -1 || Math.abs(delta) < 1 && Number(packet.pos) < Number(best.pos)) next = entry;
        }
        if (!next) break;
        const packet = next[1].head!.packet;
        next[1].head = pcm ? pcmHead(packet.pts + Math.ceil(Number(packet.size) / pcm.blockAlign)) : await read(next[1].head!.next);
        if (!selected.has(next[0])) continue;
        current = Number(packet.pts_time);
        if (first && interval.relativeEnd && !interval.packets && end !== undefined) end += current;
        first = false;
        if (end !== undefined && (interval.packets ? count >= end : Math.round(current * 1e6) >= Math.round(end * 1e6))) break;
        count++;
        yield packet;
      }
    }
  }
  // Counts and output replay the same selection, without collecting packet rows.
  for await (const packet of scan()) counts.set(packet.stream_index, (counts.get(packet.stream_index) ?? 0) + 1);
  return { packets: { [Symbol.asyncIterator]: scan }, counts };
}
