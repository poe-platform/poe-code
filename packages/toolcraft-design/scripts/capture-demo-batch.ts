import { main } from "./demo.js";
import { resetOutputFormatCache } from "../src/index.js";

type CaptureRequest = {
  args: string[];
  format: "markdown" | "json";
};

const requests = JSON.parse(process.argv[2] ?? "[]") as CaptureRequest[];
const outputs: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

try {
  for (const request of requests) {
    let output = "";
    process.env.OUTPUT_FORMAT = request.format;
    resetOutputFormatCache();
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as typeof process.stdout.write;

    await main(request.args);
    outputs.push(output);
  }
} finally {
  process.stdout.write = originalWrite;
}

process.stdout.write(JSON.stringify(outputs));
