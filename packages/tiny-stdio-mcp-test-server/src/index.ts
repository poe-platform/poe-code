import { createServer, defineSchema } from "tiny-stdio-mcp-server";
import { appendFileSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };

const SERVER_NAME = "tiny-stdio-mcp-test-server";
const SERVER_VERSION = packageJson.version;

const caesarCipherSchema = defineSchema({
  text: { type: "string", description: "The text to encrypt" },
  shift: {
    type: "integer",
    description: "The shift amount (default: 3)",
    optional: true,
  },
});

export function caesarEncrypt(text: string, shift: number): string {
  if (!Number.isInteger(shift)) {
    throw new Error("Caesar cipher shift must be a finite integer");
  }

  const normalizedShift = ((shift % 26) + 26) % 26;
  return text
    .split("")
    .map((char) => {
      if (char >= "a" && char <= "z") {
        return String.fromCharCode(
          ((char.charCodeAt(0) - 97 + normalizedShift) % 26) + 97
        );
      }
      if (char >= "A" && char <= "Z") {
        return String.fromCharCode(
          ((char.charCodeAt(0) - 65 + normalizedShift) % 26) + 65
        );
      }
      return char;
    })
    .join("");
}

const wordOfTheDaySchema = defineSchema({});

export function createEncryptServer() {
  return createServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })
  // Deliberately text-only fixture: encryption returns human-readable text, not structured data.
  .tool(
    "caesar_cipher_encrypt",
    "Encrypts text using the Caesar cipher",
    caesarCipherSchema,
    ({ text, shift }) => {
      recordToolCall("caesar_cipher_encrypt");
      const actualShift = shift ?? 3;
      return caesarEncrypt(text, actualShift);
    }
  );
}

function recordToolCall(name: string): void {
  const filePath = process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE;
  if (filePath !== undefined) {
    appendFileSync(filePath, `${name}\n`);
  }
}

export function createWordOfTheDayServer() {
  return createServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })
  // Deliberately text-only fixture: word of the day is human-readable prose.
  .tool(
    "word_of_the_day",
    "Returns the word of the day",
    wordOfTheDaySchema,
    () => {
      recordToolCall("word_of_the_day");
      return "Bumfuzzle - to confuse or fluster someone";
    }
  );
}

export function createTestServer() {
  const server = createServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Deliberately text-only fixture: encryption returns human-readable text, not structured data.
  server.tool(
    "caesar_cipher_encrypt",
    "Encrypts text using the Caesar cipher",
    caesarCipherSchema,
    ({ text, shift }) => {
      recordToolCall("caesar_cipher_encrypt");
      const actualShift = shift ?? 3;
      return caesarEncrypt(text, actualShift);
    }
  );

  // Deliberately text-only fixture: word of the day is human-readable prose.
  server.tool(
    "word_of_the_day",
    "Returns the word of the day",
    wordOfTheDaySchema,
    () => {
      recordToolCall("word_of_the_day");
      return "Bumfuzzle - to confuse or fluster someone";
    }
  );

  return server;
}
