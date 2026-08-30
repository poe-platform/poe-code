function value(input) {
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack,
      ...Object.fromEntries(Object.getOwnPropertyNames(input).filter(key => key !== "stack" && key !== "message").map(key => [key, value(input[key])])) };
  }
  if (typeof input === "bigint") return String(input);
  if (Array.isArray(input)) return input.map(value);
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, value(entry)]));
  return input;
}

export default async function* reporter(events) {
  for await (const event of events) {
    if (["test:pass", "test:fail", "test:summary", "test:diagnostic", "test:stdout", "test:stderr"].includes(event.type)) {
      yield `${JSON.stringify(value(event))}\n`;
    }
  }
}
