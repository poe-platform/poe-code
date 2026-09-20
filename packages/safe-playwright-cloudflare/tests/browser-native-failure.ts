export function failureText(error: unknown) {
	const pending = [error];
	const messages: string[] = [];
	for (let inspected = 0; pending.length && inspected < 16; inspected++) {
		const current = pending.shift();
		messages.push(String(current));
		if (current instanceof AggregateError)
			pending.push(...current.errors.slice(0, 16));
	}
	return messages.join("; ");
}
