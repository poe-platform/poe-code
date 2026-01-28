const streams = [process.stdin, process.stdout, process.stderr];

for (const stream of streams) {
  if (stream && stream.isTTY !== true) {
    stream.isTTY = true;
  }
  if (stream && typeof stream.setRawMode !== "function") {
    stream.setRawMode = () => {};
  }
  if (stream && typeof stream.columns !== "number") {
    stream.columns = 80;
  }
  if (stream && typeof stream.rows !== "number") {
    stream.rows = 24;
  }
}
