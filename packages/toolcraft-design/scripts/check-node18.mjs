import { PassThrough, Writable } from "node:stream";
import { promptText } from "../dist/index.js";

const input = new PassThrough();
const output = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  }
});

input.isTTY = false;
output.isTTY = false;
input.end("node18-smoke\n");

const result = await promptText({
  message: "Smoke?",
  input,
  output
});

if (result !== "node18-smoke") {
  throw new Error(`Unexpected prompt result: ${String(result)}`);
}

process.stdout.write("toolcraft-design Node 18 smoke passed\n");
