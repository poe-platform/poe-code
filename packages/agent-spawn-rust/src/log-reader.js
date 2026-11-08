import { open } from "node:fs/promises";
import { native } from "./native.js";
import { mapLegacyEventToSessionUpdates } from "./acp/stream-helpers.js";

function malformed(record, options) {
  const location = `${record.filePath}:${record.lineNumber}: ${record.message}`;
  if (options.strict === true) throw new Error(`Malformed spawn log record at ${location}`);
  (
    options.onMalformedRecord ??
    ((record) => {
      process.stderr.write(
        `Skipping malformed spawn log record at ${record.filePath}:${record.lineNumber}: ${record.message}\n`
      );
    })
  )(record);
}
async function* frameRecords(stream) {
  const reader = new native.NativeSpawnLogReader();
  for await (const chunk of stream) yield reader.push(chunk);
  const last = reader.end();
  if (last !== null) yield { text: last.text, layout: [last.text.length, last.lineNumber] };
}
export async function* readSpawnLog(filePath, options = {}) {
  const handle = await open(filePath, "r");
  let stream;
  try {
    stream = handle.createReadStream({ encoding: "utf8" });
    for await (const records of frameRecords(stream)) {
      let start = 0;
      for (let index = 0; index < records.layout.length; index += 2) {
        const text = records.text.slice(start, records.layout[index]);
        start = records.layout[index];
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          malformed(
            {
              filePath,
              lineNumber: records.layout[index + 1],
              message:
                error instanceof Error && error.message.length > 0 ? error.message : String(error)
            },
            options
          );
          continue;
        }
        if (typeof parsed === "object" && parsed !== null) {
          if ("sessionUpdate" in parsed && typeof parsed.sessionUpdate === "string") {
            yield parsed;
            continue;
          }
          if ("event" in parsed && typeof parsed.event === "string") {
            for (const update of mapLegacyEventToSessionUpdates(parsed)) yield update;
            continue;
          }
        }
        malformed(
          {
            filePath,
            lineNumber: records.layout[index + 1],
            message: "Unknown spawn log record shape."
          },
          options
        );
      }
    }
  } finally {
    if (stream && !stream.destroyed) stream.destroy();
    await handle.close().catch(() => {});
  }
}
