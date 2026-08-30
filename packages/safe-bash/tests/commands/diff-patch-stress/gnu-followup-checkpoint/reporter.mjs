export default async function* report(events) {
  for await (const event of events) {
    if (!["test:pass", "test:fail", "test:summary"].includes(event.type)) continue;
    yield `${JSON.stringify(event, (key, value) => {
      if (value instanceof Error) return Object.fromEntries(Object.getOwnPropertyNames(value).map(name => [name, value[name]]));
      if (typeof value === "bigint") return value.toString();
      return value;
    })}\n`;
  }
}
