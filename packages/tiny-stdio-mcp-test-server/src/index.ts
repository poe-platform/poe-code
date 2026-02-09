import { createServer, defineSchema } from "tiny-stdio-mcp-server";

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

export function createEncryptServer() {
  return createServer({
    name: "tiny-stdio-mcp-test-server",
    version: "0.0.1",
  }).tool(
    "caesar_cipher_encrypt",
    "Encrypts text using the Caesar cipher",
    caesarCipherSchema,
    ({ text, shift }) => {
      const actualShift = shift ?? 3;
      return caesarEncrypt(text, actualShift);
    }
  );
}

export function createWordOfTheDayServer() {
  return createServer({
    name: "tiny-stdio-mcp-test-server",
    version: "0.0.1",
  }).tool(
    "word_of_the_day",
    "Returns the word of the day",
    wordOfTheDaySchema,
    () => {
      return "Bumfuzzle - to confuse or fluster someone";
    }
  );
}

export function createTestServer() {
  const server = createServer({
    name: "tiny-stdio-mcp-test-server",
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
