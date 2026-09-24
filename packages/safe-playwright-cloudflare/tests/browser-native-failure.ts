export function failureText(error: unknown) {
	const pending = [error];
	const seen = new Set<unknown>();
	const messages: string[] = [];
	for (let inspected = 0; pending.length && inspected < 16; inspected++) {
		const current = pending.shift();
		if (seen.has(current)) continue;
		seen.add(current);
		messages.push(String(current));
		if (current instanceof AggregateError)
			pending.push(...current.errors.slice(0, 16));
		if (current instanceof Error) {
			if (current.cause !== undefined) pending.push(current.cause);
			// assert.rejects retains the rejected value in actual, not cause.
			if (current.name === "AssertionError" && "actual" in current)
				pending.push(current.actual);
		}
	}
	return messages.join("; ");
}
