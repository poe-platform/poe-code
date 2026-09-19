import assert from "node:assert/strict";
import { DurableObject } from "cloudflare:workers";
import type { BrowserWorker } from "@cloudflare/playwright";
import {
	CommandRegistry,
	createMemoryFileSystem,
	Shell,
	toByteSource,
	type InvocationCleanup,
} from "@poe-platform/safe-bash";
import { createBrowserProfileStore } from "./browser-profile-store.fixture";
import {
	coldRestore,
	largeScriptRestore,
	twoReplacements,
	nativeCDPOwnership,
	profileLifecycle,
	type Origins,
	type Fixture,
} from "./browser-storage-admission.test.worker-cases";
import {
	seed,
	mobileStorage,
	checkpointBaseline,
} from "./browser-storage-admission.test.worker-records";
import { createPersistentPlaywright } from "./persistent-playwright.fixture";
import {
	assertCommandFailure,
	checkpointFailures,
	publicReaderLimit,
	failureText,
	heldGuest,
} from "./browser-storage-admission.test.worker-controls";
import {
	controlFaultBinding,
	checkpointControlEOF,
} from "./browser-storage-admission.test.worker-relay";

interface Env {
	BROWSER: BrowserWorker;
	BROWSER_RUN_CODE_LOADER: WorkerLoader;
	PROFILE_KV: KVNamespace;
	PROFILE_OWNERS: DurableObjectNamespace<StorageAdmissionProfiles>;
}

export class StorageAdmissionProfiles extends DurableObject<Env> {
	#now = 1000;
	#store = createBrowserProfileStore({
		storage: this.ctx.storage,
		kv: this.env.PROFILE_KV,
		ownerKey: this.ctx.id.toString(),
		now: () => this.#now,
	});

	async load(name: string, resumeOnly = false) {
		return this.#store.load(name, undefined, { resumeOnly });
	}
	async save(name: string, bytes: Uint8Array) {
		await this.#store.save(name, bytes);
	}
	async list() {
		return this.#store.list();
	}
	async markClosed(name?: string) {
		await this.#store.markClosed(name);
	}
	async remove(name: string) {
		await this.#store.remove(name);
	}
	async expire() {
		return this.#store.expire();
	}
	advanceClock(milliseconds: number) {
		this.#now += milliseconds;
	}
}

async function assertProfileStore(env: Env) {
	const owner = env.PROFILE_OWNERS.getByName("profile-admission-owner");
	const other = env.PROFILE_OWNERS.getByName("profile-admission-other-owner");
	const bytes = new TextEncoder().encode(
		'{"state":{"cookies":[],"origins":[]},"tabs":["about:blank"],"selected":0}',
	);
	await owner.save("named", bytes);
	assert.deepEqual(await owner.load("named"), bytes);
	assert.equal(await other.load("named"), undefined);
	await assert.rejects(
		owner.save("named", new Uint8Array(2 * 1024 * 1024 + 1)),
		/limit/,
	);
	assert.deepEqual(await owner.load("named"), bytes);
	await Promise.all(
		Array.from({ length: 15 }, (_, index) =>
			owner.save(`profile-${index}`, bytes),
		),
	);
	assert.equal((await owner.list()).length, 16);
	await assert.rejects(owner.save("overflow", bytes), /limit/);
	await owner.markClosed("named");
	assert.equal(await owner.load("named", true), undefined);
	assert.deepEqual(await owner.load("named"), bytes);
	await owner.remove("named");
	assert.equal(await owner.load("named"), undefined);
	await owner.advanceClock(86_400_000);
	assert.deepEqual(await owner.list(), []);
}

function profileStore(env: Env, owner: string) {
	const remote = env.PROFILE_OWNERS.getByName(owner);
	const store: ReturnType<typeof createBrowserProfileStore> = {
		async expire() {
			return remote.expire();
		},
		async list(signal) {
			signal?.throwIfAborted();
			return remote.list();
		},
		async markClosed(name, signal) {
			signal?.throwIfAborted();
			await remote.markClosed(name);
		},
		async load(name, signal, options) {
			signal?.throwIfAborted();
			return remote.load(name, options?.resumeOnly);
		},
		async save(name, bytes, signal) {
			signal?.throwIfAborted();
			await remote.save(name, bytes);
		},
		async remove(name) {
			await remote.remove(name);
		},
	};
	return store;
}

function fixture(env: Env, owner: string, binding = env.BROWSER) {
	const profiles = profileStore(env, owner);
	const client = createPersistentPlaywright({
		binding,
		profiles,
		runtime: { ownerId: owner, loader: env.BROWSER_RUN_CODE_LOADER },
	});
	const fs = createMemoryFileSystem();
	const host = new Shell({ fs, commands: new CommandRegistry() });
	client.plugin.setup(host);
	const command = host.commands.get("playwright-cli");
	async function run(args: string[], signal = new AbortController().signal) {
		assert.ok(command);
		let stdout = "";
		let stderr = "";
		const cleanups: InvocationCleanup[] = [];
		try {
			const result = await command.execute({
				command: command.name,
				args,
				stdin: toByteSource(new Uint8Array()),
				cwd: "/",
				env: {},
				fs,
				signal,
				registerCleanup: (cleanup) => cleanups.push(cleanup),
				stdout: {
					async write(bytes) {
						stdout += new TextDecoder().decode(bytes);
					},
				},
				stderr: {
					async write(bytes) {
						stderr += new TextDecoder().decode(bytes);
					},
				},
			});
			return { exitCode: result.exitCode, stdout, stderr };
		} finally {
			await Promise.all(cleanups.map((cleanup) => cleanup()));
		}
	}
	return { profiles, client, fs, run };
}

async function checkpointControlFailure(
	create: (owner: string, binding: BrowserWorker) => Fixture,
	native: BrowserWorker,
	input: Origins,
	cancel: boolean,
) {
	const control = controlFaultBinding(native);
	const f = create(
		cancel ? "checkpoint-held-cancel" : "checkpoint-close-failure",
		control.binding,
	);
	try {
		assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
		const session = f.client.inspectSessions()[0]!;
		assert.ok(session.selectedPage);
		await seed(session.selectedPage, "committed");
		assert.equal(
			(await f.run(["eval", "() => undefined", "--json"])).exitCode,
			0,
		);
		const previous = await f.profiles.load(session.name);
		assert.ok(previous);
		const before = control.destroyedTargets;
		const abort = new AbortController();
		if (cancel) control.holdNextEvaluation();
		else control.failClose();
		const command = Promise.allSettled([
			f.run(["eval", "() => undefined", "--json"], abort.signal),
		]);
		if (cancel) {
			await control.evaluationHeld;
			abort.abort(new Error("storage-admission-held-checkpoint-cancelled"));
			control.resumeEvaluation();
		}
		const [outcome] = await command;
		assertCommandFailure(
			outcome,
			cancel ? /held-checkpoint-cancelled/ : /injected-close-failure/,
		);
		assert.ok(
			control.destroyedTargets > before,
			"Owned target was actually retired on the native control plane",
		);
		assert.equal(control.injectedResponses, cancel ? 0 : 1);
		assert.deepEqual(await f.profiles.load(session.name), previous);
		await f.client.dispose();
		await control.assertNativeRetirement();
		assert.deepEqual(await f.profiles.load(session.name), previous);
	} catch (error) {
		const [disposal] = await Promise.allSettled([f.client.dispose()]);
		if (disposal.status === "rejected")
			throw new AggregateError(
				[error, disposal.reason],
				"Acceptance operation and disposal failed",
			);
		throw error;
	}
}

export default {
	async fetch(request: Request, env: Env) {
		const input: Origins = await request.json();
		const pathname = new URL(request.url).pathname;
		if (pathname === "/profile-store") {
			try {
				await assertProfileStore(env);
				return Response.json({ ok: true });
			} catch (error) {
				return Response.json({ error: String(error) }, { status: 500 });
			}
		}
		const active = fixture(
			env,
			pathname.startsWith("/profile-lifecycle-")
				? "profile-lifecycle"
				: pathname,
		);
		const { client } = active;
		try {
			if (pathname.startsWith("/profile-lifecycle-")) {
				await profileLifecycle(
					active,
					input,
					pathname.slice("/profile-lifecycle-".length),
				);
				return Response.json({ ok: true });
			}
			switch (pathname) {
				case "/checkpoint-navigation-timeout":
				case "/checkpoint-navigation-cancel": {
					const relay = controlFaultBinding(env.BROWSER);
					const f = fixture(env, pathname, relay.binding);
					try {
						await f.run(["open", input.origin, "--json"]);
						const before = f.client.inspectSessions()[0]!;
						await seed(before.selectedPage!, "checkpoint-original-tab");
						assert.equal(
							(await f.run(["eval", "() => undefined", "--json"])).exitCode,
							0,
						);
						const previous = await f.profiles.load(before.name);
						assert.ok(previous);
						relay.holdNextNavigation();
						const abort = new AbortController();
						const pending = f.run(
							["goto", input.origin + "/completed", "--json"],
							abort.signal,
						);
						await relay.navigationHeld;
						assert.equal(
							before.selectedPage!.url(),
							input.origin + "/completed",
						);
						await before.selectedPage!.evaluate!(() => {
							document.documentElement.dataset.checkpointWitness = "completed";
						}, undefined);
						// This is a completed guest navigation plus a deliberately withheld
						// hidden-target reply, not a reproduction of the historical stall.
						if (pathname.endsWith("cancel")) {
							abort.abort(new Error("checkpoint-navigation-cancelled"));
							relay.resumeNavigation();
							const outcome = await Promise.allSettled([pending]);
							assertCommandFailure(
								outcome[0]!,
								/checkpoint-navigation-cancelled/,
							);
							assert.equal(f.client.inspectSessions().length, 0);
						} else {
							const result = await pending;
							assert.equal(result.exitCode, 1);
							assert.match(
								result.stderr,
								/Action completed; persistence failed/,
							);
							assert.ok(JSON.parse(result.stdout).page.includes("/completed"));
							const after = f.client.inspectSessions()[0]!;
							assert.equal(after.context, before.context);
							assert.equal(after.selectedPage, before.selectedPage);
							assert.equal(
							await after.selectedPage!.title!(),
								"Storage admission",
							);
							assert.deepEqual(await f.profiles.load(before.name), previous);
							const destroyed = relay.destroyedTargets;
							assert.ok(destroyed > 0);
							assert.equal(relay.activeTargetCount, 0);
							assert.equal(
								await before.selectedPage!.evaluate!(
									() => document.documentElement.dataset.checkpointWitness,
									undefined,
								),
								"completed",
							);
							relay.resumeNavigation();
							assert.equal(
								(await f.run(["eval", "() => undefined", "--json"])).exitCode,
								0,
							);
							assert.equal(
								await before.selectedPage!.evaluate!(
									() => document.documentElement.dataset.checkpointWitness,
									undefined,
								),
								"completed",
							);
							assert.equal(
								f.client.inspectSessions()[0]!.selectedPage,
								before.selectedPage,
							);
							assert.notDeepEqual(await f.profiles.load(before.name), previous);
							assert.ok(relay.destroyedTargets > destroyed);
						}
					} finally {
						await f.client.dispose();
					}
					await relay.assertNativeRetirement();
					return Response.json({ ok: true });
				}
				case "/native-cdp-ownership":
					await nativeCDPOwnership((owner) => fixture(env, owner), input);
					return Response.json({ ok: true });
				case "/mobile-storage":
					await mobileStorage(active, input);
					return Response.json({ ok: true });
				case "/held-guest":
					await heldGuest(env.BROWSER, env.BROWSER_RUN_CODE_LOADER, input);
					return Response.json({ ok: true });
				case "/checkpoint-close-failure":
				case "/checkpoint-held-cancel":
					await checkpointControlFailure(
						(owner, binding) => fixture(env, owner, binding),
						env.BROWSER,
						input,
						pathname === "/checkpoint-held-cancel",
					);
					return Response.json({ ok: true });
				case "/checkpoint-control-eof":
					await checkpointControlEOF(
						(owner, binding) => fixture(env, owner, binding),
						env.BROWSER,
						input,
					);
					return Response.json({ ok: true });
				case "/large-script-save":
				case "/large-script-restore":
          await largeScriptRestore(fixture(env, 'large-script'), pathname === '/large-script-save' ? 'save' : 'restore');
          return Response.json({ ok: true });
				case "/cold-owner-save":
				case "/cold-owner-restore":
					await coldRestore(
						(owner) => fixture(env, owner, controlFaultBinding(env.BROWSER).binding),
						input,
						pathname === "/cold-owner-save" ? "save" : "restore",
					);
					return Response.json({ ok: true });
				case "/two-replacements":
					await twoReplacements(active, input);
					return Response.json({ ok: true });
				case "/checkpoint-failures":
					await checkpointFailures(
						(owner, binding) => fixture(env, owner, binding),
						env.BROWSER,
						input,
					);
					return Response.json({ ok: true });
				case "/public-reader-limit":
					await publicReaderLimit(
						(owner, binding) => fixture(env, owner, binding),
						env.BROWSER,
						input,
					);
					return Response.json({ ok: true });
			}
			await checkpointBaseline(active, input, pathname);
			return Response.json({ ok: true });
		} catch (error) {
			return Response.json({ error: failureText(error) }, { status: 500 });
		} finally {
			await client.dispose();
		}
	},
};
