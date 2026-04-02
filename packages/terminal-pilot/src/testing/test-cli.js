#!/usr/bin/env node
import readline from "node:readline";

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let hasGreeted = false;
let interrupted = false;

process.stdout.write("What is your name? ");

terminal.on("line", (name) => {
  if (hasGreeted) {
    return;
  }

  hasGreeted = true;
  console.log(`Hello, ${name}!`);
  terminal.close();
});

terminal.on("SIGINT", () => {
  interrupted = true;
  terminal.close();
  process.kill(process.pid, "SIGINT");
});

terminal.on("close", () => {
  if (!hasGreeted) {
    console.log(`Hello, ${terminal.line}!`);
  }

  if (!interrupted) {
    process.exit(0);
  }
});
