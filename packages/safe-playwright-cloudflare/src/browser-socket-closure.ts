interface SocketClosure {
	promise: Promise<void>;
	fail(error: unknown): void;
	ownerClosing: boolean;
	closing: boolean;
	ownerTerminated?: boolean;
	finalizeOwnerTermination(deleted: boolean): void;
}

const closures = new WeakMap<WebSocket, SocketClosure>();

function nativeClosedEOF(socket: WebSocket, event: Event): Error | undefined {
	if (
		event instanceof ErrorEvent &&
		event.isTrusted &&
		socket.readyState === WebSocket.CLOSED &&
		event.error instanceof Error &&
		event.error.message === "Network connection lost."
	)
		return event.error;
	return undefined;
}

export function beginBrowserOwnerShutdown(sockets: Iterable<WebSocket>) {
	for (const socket of sockets) {
		const closure = closures.get(socket);
		if (closure) closure.ownerClosing = true;
	}
}

export function finalizeBrowserOwnerTermination(
	sockets: Iterable<WebSocket>,
	deleted: boolean,
) {
	for (const socket of sockets)
		closures.get(socket)?.finalizeOwnerTermination(deleted);
}

export function registerBrowserSocketClose(socket: WebSocket, alias = socket) {
	let closure = closures.get(socket);
	if (!closure) {
		const completion = Promise.withResolvers<void>();
		let settled = false;
		let eof: Error | undefined;
		let eofDuringClose = false;
		const cleanup = () => {
			socket.removeEventListener("close", closed);
			socket.removeEventListener("error", failed);
		};
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			if (error === undefined) completion.resolve();
			else completion.reject(error);
		};
		const closed = (event: CloseEvent) => {
			cleanup();
			finish(
				event.code === 1000 || event.code === 1005
					? undefined
					: new Error(
							`Owned browser upstream closed: ${event.code} ${event.reason}`,
							{ cause: eof },
						),
			);
		};
		const failOperation = (error: unknown) => {
			cleanup();
			finish(error);
		};
		const failed = (event: Event) => {
			const nativeEOF = nativeClosedEOF(socket, event);
			if (!nativeEOF) {
				failOperation(
					new Error(
						"Owned browser upstream socket failed before close confirmation",
					),
				);
				return;
			}
			eof = new Error(
				"Owned browser upstream socket failed before close confirmation",
				{ cause: nativeEOF },
			);
			eofDuringClose = closure!.ownerClosing || closure!.closing;
			socket.removeEventListener("error", failed);
			if (!eofDuringClose) {
				failOperation(eof);
				return;
			}
			if (closure!.ownerTerminated !== undefined)
				closure!.finalizeOwnerTermination(closure!.ownerTerminated);
		};
		closure = {
			promise: completion.promise,
			fail: failOperation,
			ownerClosing: false,
			closing: false,
			finalizeOwnerTermination(deleted) {
				closure!.ownerTerminated = deleted;
				if (!eof || !eofDuringClose || socket.readyState !== WebSocket.CLOSED)
					return;
				cleanup();
				finish(deleted ? undefined : eof);
			},
		};
		closures.set(socket, closure);
		socket.addEventListener("close", closed);
		socket.addEventListener("error", failed);
		if (socket.readyState === WebSocket.CLOSED) {
			cleanup();
			finish();
		}
		void completion.promise.catch(() => {});
	}
	closures.set(alias, closure);
	return closure.promise;
}

export function waitForBrowserSocketClose(socket: WebSocket): Promise<void> {
	return (
		closures.get(socket)?.promise ??
		Promise.reject(
			new Error("Untracked browser socket has no upstream close confirmation"),
		)
	);
}

export function closeBrowserSocket(socket: WebSocket) {
	try {
		const closure = closures.get(socket);
		if (closure) closure.closing = true;
		if (socket.readyState === WebSocket.CLOSED) return;
		socket.accept();
		socket.close();
	} catch (error) {
		closures.get(socket)?.fail(error);
		throw error;
	}
}
