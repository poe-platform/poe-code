#!/usr/bin/env tsx
import readline from "node:readline";

const options = ["Option 1", "Option 2", "Option 3"];
const { stdin, stdout } = process;
let selectedIndex = 0;
let renderedLineCount = 0;
let hasExited = false;

readline.emitKeypressEvents(stdin);

if (stdin.isTTY) {
  stdin.setRawMode(true);
}

stdin.resume();
render();

stdin.on("keypress", (_, key) => {
  if (key.ctrl && key.name === "c") {
    exitWithCode(130);
    return;
  }

  if (key.name === "up") {
    selectedIndex = (selectedIndex + options.length - 1) % options.length;
    render();
    return;
  }

  if (key.name === "down") {
    selectedIndex = (selectedIndex + 1) % options.length;
    render();
    return;
  }

  if (key.name === "return" || key.name === "enter") {
    cleanup();
    stdout.write(`You selected: ${options[selectedIndex]}\n`);
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  exitWithCode(130);
});

function cleanup() {
  if (stdin.isTTY) {
    stdin.setRawMode(false);
  }

  stdin.pause();
}

function render() {
  if (renderedLineCount > 0) {
    readline.moveCursor(stdout, 0, -renderedLineCount);
    readline.clearScreenDown(stdout);
  }

  const lines = [
    "Select an option:",
    ...options.map((option, index) => `${index === selectedIndex ? ">" : " "} ${option}`)
  ];

  stdout.write(`${lines.join("\n")}\n`);
  renderedLineCount = lines.length;
}

function exitWithCode(code: number) {
  if (hasExited) {
    return;
  }

  hasExited = true;
  cleanup();
  process.exit(code);
}
