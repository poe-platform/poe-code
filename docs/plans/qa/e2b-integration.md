# E2B Integration QA

- [ ] Fresh repo initialization
  - Run `poe-code runtime init` in a repository without an existing `.poe-code` directory.
  - Assert `.poe-code/Dockerfile` is created.
  - Assert `.poe-code/config.json` is created.

- [ ] E2B template build cache
  - Run an E2B-backed command once with the initialized runtime config.
  - Assert the first run builds an E2B template.
  - Run the same command again without changing the Dockerfile or build context.
  - Assert the second run resolves the same template from cache instead of rebuilding.

- [ ] Detached Ralph run
  - Run `poe-code ralph plan.md --runtime e2b --detach`.
  - Assert the command returns a `jobId`.
  - Assert the sandbox is visible in the E2B dashboard.

- [ ] Attach and detach log streaming
  - Run `poe-code runtime jobs attach <id>` with the detached job id.
  - Assert the command resumes the job log.
  - Press Ctrl-C.
  - Assert the local attach session detaches without killing the remote job.

- [ ] Stop and sync back
  - Run `poe-code runtime jobs stop <id>`.
  - Assert the remote job is killed.
  - Assert the workspace sync-back runs before local state is cleaned up.

- [ ] Sync-back conflict messaging
  - Start a detached E2B run that modifies a tracked local file inside the sandbox.
  - Modify the same local file while the job is still running.
  - Trigger sync-back with the default conflict policy.
  - Assert the command refuses the conflicting file and lists it clearly.

- [ ] Teammate Dockerfile cache identity
  - Share the same `.poe-code/Dockerfile` and build context with another checkout.
  - Run the same E2B-backed command in both checkouts.
  - Assert the same `template_id` resolves for both users.
