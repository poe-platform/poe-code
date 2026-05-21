const streams = [process.stdin, process.stdout, process.stderr];

function readPositiveInteger(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const screenshotColumns = readPositiveInteger(process.env.POE_SCREENSHOT_COLUMNS, 80);
const screenshotRows = readPositiveInteger(process.env.POE_SCREENSHOT_ROWS, 24);

for (const stream of streams) {
  if (stream && stream.isTTY !== true) {
    stream.isTTY = true;
  }
  if (stream && typeof stream.setRawMode !== "function") {
    stream.setRawMode = () => {};
  }
  if (stream) {
    stream.columns = screenshotColumns;
  }
  if (stream) {
    stream.rows = screenshotRows;
  }
}
