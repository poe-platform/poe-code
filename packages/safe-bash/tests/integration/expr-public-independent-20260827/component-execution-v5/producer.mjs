import { once } from "node:events";
import { pathToFileURL } from "node:url";

const [mode, compiler, config] = process.argv.slice(2);
async function write(stream, bytes) { if (!stream.write(bytes)) await once(stream, "drain"); }
const block = Buffer.from("TRACE_QUALIFICATION_PADDING_ONLY\n".repeat(2048));
if (mode === "overflow" || mode === "ordinary-cap") {
  for (let index = 0; index < 1040; index++) await write(process.stdout, block);
  setInterval(() => {}, 1000);
} else if (mode === "line-overflow") {
  for (let index = 0; index < 4; index++) await write(process.stdout, Buffer.alloc(65536, 120));
  setInterval(() => {}, 1000);
} else if (mode === "diagnostic-overflow") {
  for (let index = 0; index < 300; index++) await write(process.stdout, Buffer.from(`fixture.ts(1,1): error TS2322: synthetic retention control ${index}\n`));
  setInterval(() => {}, 1000);
} else {
  for (let index = 0; index < 18; index++) await write(process.stdout, block);
  await write(process.stderr, Buffer.from("TRACE_STDERR_AFTER_PREVIEW\n"));
  if (mode === "nonzero") process.exitCode = 7;
  else {
    process.argv = [process.execPath, compiler, "-p", config, "--pretty", "false", "--traceResolution"];
    await import(pathToFileURL(compiler).href);
  }
}
