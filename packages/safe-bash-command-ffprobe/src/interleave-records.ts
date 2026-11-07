import type { MediaProbePacket, MediaProbeFrame } from "@poe-code/mp4-ast";

type Rows<T> = Iterable<T> | AsyncIterable<T>;

// Frame DTS identifies the packet that releases a decoded frame. Frames without
// DTS are decoder flush output and follow the final packet.
function released(frame: MediaProbeFrame, packet: MediaProbePacket): boolean {
  return frame.stream_index === packet.stream_index && frame.pkt_dts !== undefined && frame.pkt_dts <= packet.dts;
}

export function interleaveProbeRecords(packets: Rows<MediaProbePacket>, frames: Rows<MediaProbeFrame>) {
  return {
    *[Symbol.iterator]() {
      const iterator = (frames as Iterable<MediaProbeFrame>)[Symbol.iterator]();
      let next: IteratorResult<MediaProbeFrame> | undefined;
      try {
        for (const packet of packets as Iterable<MediaProbePacket>) {
          yield { type: "packet", record: packet };
          next ??= iterator.next();
          while (!next.done && released(next.value, packet)) {
            yield { type: "frame", record: next.value };
            next = iterator.next();
          }
        }
        next ??= iterator.next();
        while (!next.done) {
          yield { type: "frame", record: next.value };
          next = iterator.next();
        }
      } finally {
        if (!next?.done) iterator.return?.();
      }
    },
    async *[Symbol.asyncIterator]() {
      const iterator = Symbol.asyncIterator in frames ? frames[Symbol.asyncIterator]() : frames[Symbol.iterator]();
      let next: IteratorResult<MediaProbeFrame> | undefined;
      try {
        for await (const packet of packets) {
          yield { type: "packet", record: packet };
          next ??= await iterator.next();
          while (!next.done && released(next.value, packet)) {
            yield { type: "frame", record: next.value };
            next = await iterator.next();
          }
        }
        next ??= await iterator.next();
        while (!next.done) {
          yield { type: "frame", record: next.value };
          next = await iterator.next();
        }
      } finally {
        if (!next?.done) await iterator.return?.();
      }
    },
  };
}
