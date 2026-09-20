import {
	assertBrowserPrivateStorageCancellation,
	assertBrowserStorageReplacement,
} from "./browser-storage.test.worker-cases";
import { failureText } from './browser-storage-admission.test.worker-controls';

export async function handleBrowserStorageScenario(
	request: Request,
	env: Parameters<typeof assertBrowserStorageReplacement>[0],
) {
	const path = new URL(request.url).pathname;
	if (path !== "/storage-replacement" && path !== "/storage-private-cancel")
		return undefined;
	try {
		if (path === "/storage-replacement")
			await assertBrowserStorageReplacement(env);
		else await assertBrowserPrivateStorageCancellation(env);
		return Response.json({ ok: true });
	} catch (error) {
		return Response.json({ error: failureText(error) }, { status: 500 });
	}
}
