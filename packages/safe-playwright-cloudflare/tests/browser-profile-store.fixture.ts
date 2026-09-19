// Consumer host policy fixture from poe2 a03e2c7; intentionally not published.
import { createHash } from "node:crypto";
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const PROFILE_TTL_MS = 86_400_000;
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const JOURNAL_CHUNK_BYTES = 64 * 1024;
const MAX_PROFILES = 16;
const MANIFEST_PREFIX = "browser-profile:manifest:";

interface ProfileVersion {
	key: string;
	expiresAt: number;
	bytes: number;
	digest: string;
}
interface ProfileManifest {
	name: string;
	current?: ProfileVersion;
	resumable?: boolean;
	retired: string[];
}
type ProfileKV = Pick<KVNamespace, "put" | "delete"> & {
	get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
};

/** Only the authenticated owner DO constructs this store. KV keys are immutable;
 * the DO manifest is authoritative, including deletion. A bounded durable journal
 * covers KV propagation misses immediately after a Worker restart. */
export function createBrowserProfileStore(options: {
	storage: DurableObjectStorage;
	kv: ProfileKV;
	ownerKey: string;
	now(): number;
}) {
	const { storage, kv, ownerKey, now } = options;
	let tail = Promise.resolve();
	function serialized<T>(operation: () => Promise<T>): Promise<T> {
		// Observe immediate rejection before leaving the owner request context.
		const result = tail.then(async () => await operation());
		tail = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	async function index(name: string) {
		if (!name || new TextEncoder().encode(name).byteLength > 256)
			throw new Error("Invalid browser profile name");
		return `${MANIFEST_PREFIX}${await sha256Hex(new TextEncoder().encode(name))}`;
	}
	// O(MAX_PROFILES); admission bounds manifests, including pending tombstones.
	async function manifests() {
		const entries = await storage.list<ProfileManifest>({
			prefix: MANIFEST_PREFIX,
			limit: MAX_PROFILES + 1,
		});
		if (entries.size > MAX_PROFILES)
			throw new Error("Browser profile manifest limit exceeded");
		return entries;
	}
	function chunks(key: string, size: number) {
		return Array.from(
			{ length: Math.ceil(size / JOURNAL_CHUNK_BYTES) },
			(_, i) =>
				`browser-profile:chunk:${key.slice(MANIFEST_PREFIX.length)}:${i}`,
		);
	}
	async function clean(
		key: string,
		manifest: ProfileManifest,
		required = false,
	) {
		if (!manifest.retired.length) return;
		// Deletions are independent; persist only the failed keys for retry.
		const results = await Promise.allSettled(
			manifest.retired.map((entry) => kv.delete(entry)),
		);
		manifest.retired = manifest.retired.filter(
			(_, index) => results[index]!.status === "rejected",
		);
		if (manifest.current || manifest.retired.length)
			await storage.put(key, manifest);
		else await storage.delete(key);
		const failure = results.find((result) => result.status === "rejected");
		if (required && failure?.status === "rejected") throw failure.reason;
	}
	async function remove(
		key: string,
		manifest: ProfileManifest,
		required = true,
	) {
		const current = manifest.current;
		const tombstone: ProfileManifest = {
			name: manifest.name,
			retired: [...manifest.retired, ...(current ? [current.key] : [])],
		};
		await storage.transaction(async (transaction) => {
			await transaction.put(key, tombstone);
			if (current) await transaction.delete(chunks(key, current.bytes));
		});
		await clean(key, tombstone, required);
	}
	async function expire() {
		const entries = await manifests();
		const expiries = await Promise.all(
			[...entries].map(async ([key, manifest]) => {
				await clean(key, manifest);
				if (!manifest.current) return Infinity;
				if (manifest.current.expiresAt > now())
					return manifest.current.expiresAt;
				await remove(key, manifest, false);
				return Infinity;
			}),
		);
		const next = Math.min(...expiries);
		return Number.isFinite(next) ? next : undefined;
	}
	async function activeVersion(key: string, manifest: ProfileManifest) {
		await clean(key, manifest);
		const current = manifest.current;
		if (!current) return;
		if (current.expiresAt > now()) return current;
		await remove(key, manifest, false);
	}
	async function admitProfile(previous: ProfileManifest) {
		if (previous.retired.length >= 8)
			throw new Error("Browser profile cleanup backlog limit exceeded");
		if (previous.current) return;
		const existing = await storage.list({
			prefix: MANIFEST_PREFIX,
			limit: MAX_PROFILES,
		});
		if (existing.size >= MAX_PROFILES)
			throw new Error(
				"Browser saved profile limit exceeded; delete-data removes unused profiles",
			);
	}
	async function readJournal(key: string, size: number) {
		const bytes = new Uint8Array(size);
		const keys = chunks(key, size);
		const journal = await storage.get<Uint8Array>(keys);
		for (let i = 0; i < keys.length; i++) {
			const part = journal.get(keys[i]!);
			if (!part)
				throw new Error("Browser profile recovery journal is incomplete");
			bytes.set(part, i * JOURNAL_CHUNK_BYTES);
		}
		return bytes;
	}
	async function readVersion(
		key: string,
		current: ProfileVersion,
		signal?: AbortSignal,
	) {
		// Immutable version plus authoritative journal handles KV misses/outages.
		const remote = await kv.get(current.key, "arrayBuffer").catch(() => null);
		signal?.throwIfAborted();
		const bytes = remote
			? new Uint8Array(remote)
			: await readJournal(key, current.bytes);
		if (
			bytes.byteLength !== current.bytes ||
			(await sha256Hex(bytes)) !== current.digest
		)
			throw new Error("Browser profile integrity check failed");
		signal?.throwIfAborted();
		return bytes;
	}
	async function publish(options: {
		key: string;
		previous: ProfileManifest;
		current: ProfileVersion;
		bytes: Uint8Array;
		signal?: AbortSignal;
	}) {
		const { key, previous, current, bytes, signal } = options;
		signal?.throwIfAborted();
		await kv.put(current.key, bytes, { expirationTtl: PROFILE_TTL_MS / 1000 });
		try {
			signal?.throwIfAborted();
			const manifest: ProfileManifest = {
				name: previous.name,
				current,
				resumable: true,
				retired: [
					...previous.retired,
					...(previous.current ? [previous.current.key] : []),
				],
			};
			await storage.transaction(async (transaction) => {
				signal?.throwIfAborted();
				if (previous.current)
					await transaction.delete(chunks(key, previous.current.bytes));
				const keys = chunks(key, bytes.byteLength);
				for (let i = 0; i < keys.length; i++) {
					signal?.throwIfAborted();
					// biome-ignore lint/performance/noAwaitInLoops: Bound outstanding journal bytes and check cancellation before each chunk.
					await transaction.put(
						keys[i]!,
						bytes.slice(i * JOURNAL_CHUNK_BYTES, (i + 1) * JOURNAL_CHUNK_BYTES),
					);
				}
				signal?.throwIfAborted();
				await transaction.put(key, manifest);
				signal?.throwIfAborted();
			});
			await clean(key, manifest);
		} catch (error) {
			// Keep a committed candidate; unreferenced candidates also have a TTL.
			const committed = await storage.get<ProfileManifest>(key);
			if (committed?.current?.key !== current.key) await kv.delete(current.key);
			throw error;
		}
	}
	return {
		expire: () => serialized(expire),
		list(signal?: AbortSignal) {
			return serialized(async () => {
				signal?.throwIfAborted();
				await expire();
				const entries = await manifests();
				signal?.throwIfAborted();
				return [...entries.values()]
					.filter((entry) => entry.current && entry.resumable !== false)
					.map((entry) => entry.name);
			});
		},
		markClosed(name?: string, signal?: AbortSignal) {
			return serialized(async () => {
				signal?.throwIfAborted();
				const keys =
					name === undefined
						? [...(await manifests()).keys()]
						: [await index(name)];
				await storage.transaction(async (transaction) => {
					const manifests = await transaction.get<ProfileManifest>(keys);
					const updated = Object.fromEntries(
						[...manifests]
							.filter(([, manifest]) => manifest.current)
							.map(([key, manifest]) => [
								key,
								{ ...manifest, resumable: false },
							]),
					);
					signal?.throwIfAborted();
					await transaction.put(updated);
					signal?.throwIfAborted();
				});
			});
		},
		load(name: string, signal?: AbortSignal, { resumeOnly = false } = {}) {
			return serialized(async () => {
				signal?.throwIfAborted();
				const key = await index(name);
				const manifest = await storage.get<ProfileManifest>(key);
				if (!manifest) return;
				const current = await activeVersion(key, manifest);
				if (!current) return;
				if (resumeOnly && manifest.resumable === false) return;
				return readVersion(key, current, signal);
			});
		},
		save(name: string, input: Uint8Array, signal?: AbortSignal) {
			if (input.byteLength > MAX_PROFILE_BYTES)
				return Promise.reject(new Error("Browser profile byte limit exceeded"));
			// Capture caller-owned bytes before waiting behind another command.
			const bytes = new Uint8Array(input);
			return serialized(async () => {
				signal?.throwIfAborted();
				const key = await index(name);
				await expire();
				const previous = (await storage.get<ProfileManifest>(key)) ?? {
					name,
					retired: [],
				};
				await clean(key, previous);
				await admitProfile(previous);
				const digest = await sha256Hex(bytes);
				if (
					previous.current?.digest === digest &&
					previous.current.expiresAt > now() + PROFILE_TTL_MS / 2
				) {
					await storage.transaction(async (transaction) => {
						signal?.throwIfAborted();
						await transaction.put(key, { ...previous, resumable: true });
						signal?.throwIfAborted();
					});
					return;
				}
				const current: ProfileVersion = {
					key: `${ownerKey}/${key}/${crypto.randomUUID()}`,
					expiresAt: now() + PROFILE_TTL_MS,
					bytes: bytes.byteLength,
					digest,
				};
				await publish({ key, previous, current, bytes, signal });
			});
		},
		remove(name: string) {
			return serialized(async () => {
				const key = await index(name);
				const manifest = await storage.get<ProfileManifest>(key);
				if (manifest) await remove(key, manifest);
			});
		},
	};
}
