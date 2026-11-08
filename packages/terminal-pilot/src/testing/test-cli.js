#!/usr/bin/env node
import readline from "node:readline";

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let hasGreeted = false;

process.on("SIGINT", () => {
  process.exit(130);
});

process.stdout.write("What is your name? ");

terminal.on("line", (name) => {
  if (hasGreeted) {
    return;
  }

  hasGreeted = true;
  console.log(`Hello, ${name}!`);
  terminal.close();
});

terminal.on("close", () => {
  if (!hasGreeted) {
    console.log(`Hello, ${terminal.line}!`);
  }

  process.exit(0);
});
