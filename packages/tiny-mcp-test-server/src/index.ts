#!/usr/bin/env node
import { createServer, defineSchema } from "@poe-code/tiny-mcp-server";

const caesarCipherSchema = defineSchema({
  text: { type: "string", description: "The text to encrypt" },
  shift: {
    type: "number",
    description: "The shift amount (default: 3)",
    optional: true,
  },
});

export function caesarEncrypt(text: string, shift: number): string {
  return text
    .split("")
    .map((char) => {
      if (char >= "a" && char <= "z") {
        return String.fromCharCode(
          ((char.charCodeAt(0) - 97 + shift) % 26) + 97
        );
      }
      if (char >= "A" && char <= "Z") {
        return String.fromCharCode(
          ((char.charCodeAt(0) - 65 + shift) % 26) + 65
        );
      }
      return char;
    })
    .join("");
}

const wordOfTheDaySchema = defineSchema({});

export function createTestServer() {
  const server = createServer({
    name: "tiny-mcp-test-server",
    version: "0.0.1",
  });

  server.tool(
    "caesar_cipher_encrypt",
    "Encrypts text using the Caesar cipher",
    caesarCipherSchema,
    ({ text, shift }) => {
      const actualShift = shift ?? 3;
      return caesarEncrypt(text, actualShift);
    }
  );

  server.tool(
    "word_of_the_day",
    "Returns the word of the day",
    wordOfTheDaySchema,
    () => {
      return "Bumfuzzle - to confuse or fluster someone";
    }
  );

  return server;
}

// Only start listening when run directly
// Handles: direct execution, npm bin symlinks, and dev mode
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("tiny-mcp-test-server/dist/index.js") ||
  process.argv[1]?.endsWith("tiny-mcp-test-server");

if (isMain) {
  createTestServer().listen();
}
