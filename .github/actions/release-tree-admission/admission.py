import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys


def run_git(repository, *arguments, allowed=(0,)):
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    environment.update(
        GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_GLOBAL=os.devnull,
        GIT_GRAFT_FILE=os.devnull, GIT_NO_LAZY_FETCH="1", GIT_OPTIONAL_LOCKS="0",
    )
    result = subprocess.run(
        ["git", "--no-replace-objects", *arguments], cwd=repository,
        capture_output=True, text=True, env=environment,
    )
    if result.returncode not in allowed:
        raise ValueError(f"Git {arguments[0]} could not validate the release comparison")
    return result


def commit_id(repository, value):
    if (
        not isinstance(value, str)
        or len(value) not in (40, 64)
        or any(character not in "0123456789abcdef" for character in value)
        or not value.strip("0")
    ):
        raise ValueError("Expected a complete nonzero commit ID")
    resolved = run_git(repository, "rev-parse", "--verify", f"{value}^{{commit}}")
    if resolved.stdout.strip() != value:
        raise ValueError("Event object is not a commit")
    return value


def release_admission(environment):
    overrides = {
        "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_GRAFT_FILE",
        "GIT_SHALLOW_FILE", "GIT_REPLACE_REF_BASE", "GIT_CONFIG", "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS", "GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS",
        "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS",
    }
    if any(
        name in overrides or name.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"))
        for name in environment
    ):
        raise ValueError("Inherited Git repository, history, configuration, or pathspec override")
    repository = environment["GITHUB_WORKSPACE"]
    event_name = environment["GITHUB_EVENT_NAME"]
    event = json.loads(Path(environment["GITHUB_EVENT_PATH"]).read_text())
    if not isinstance(event, dict) or event_name not in ("push", "workflow_dispatch"):
        raise ValueError("Unsupported release event")
    if run_git(repository, "rev-parse", "--is-shallow-repository").stdout.strip() != "false":
        raise ValueError("Release admission requires complete, non-shallow history")
    after = commit_id(repository, environment["GITHUB_SHA"])
    if run_git(repository, "rev-parse", "HEAD").stdout.strip() != after:
        raise ValueError("Checkout does not match the event SHA")
    reference = environment["GITHUB_REF"]
    if not isinstance(reference, str) or not any(
        reference.startswith(prefix) and len(reference) > len(prefix)
        for prefix in ("refs/heads/", "refs/tags/")
    ):
        raise ValueError("Invalid event reference")
    if run_git(repository, "check-ref-format", reference, allowed=(0, 1)).returncode:
        raise ValueError("Invalid Git reference syntax")
    event_reference = event.get("ref")
    if event_name == "workflow_dispatch":
        if event_reference not in (reference, reference.split("/", 2)[2]):
            raise ValueError("Dispatch reference does not match the event context")
        return True, "manual-dispatch"
    if not reference.startswith("refs/heads/") or event_reference != reference:
        raise ValueError("Push reference does not match the event context")
    if commit_id(repository, event.get("after")) != after:
        raise ValueError("Push after does not match the event SHA")
    before = commit_id(repository, event.get("before"))
    if run_git(repository, "merge-base", "--is-ancestor", before, after, allowed=(0, 1)).returncode:
        raise ValueError("Release comparison is not a fast-forward push")
    before_roots = set(run_git(repository, "rev-list", "--max-parents=0", before).stdout.splitlines())
    after_roots = set(run_git(repository, "rev-list", "--max-parents=0", after).stdout.splitlines())
    if not before_roots or not after_roots or not before_roots.issubset(after_roots):
        raise ValueError("Cannot establish complete root ancestry")
    if after_roots == before_roots:
        return True, "ordinary-push"
    merges = run_git(repository, "rev-list", "--min-parents=2", "--max-count=1", f"{before}..{after}")
    if not merges.stdout.strip():
        raise ValueError("New history has no importing merge witness")
    owned_paths = environment["RELEASE_OWNED_PATHS"].splitlines()
    if not owned_paths:
        raise ValueError("Import admission requires owned package or helper paths")
    for owned_path in owned_paths:
        parsed = PurePosixPath(owned_path)
        if (
            len(parsed.parts) < 2
            or parsed.parts[0] not in ("packages", "scripts")
            or ".." in parsed.parts
            or parsed.as_posix() != owned_path
        ):
            raise ValueError("Invalid owned package or helper path")
    changed = run_git(
        repository, "diff", "--quiet", "--no-ext-diff", "--no-textconv", "--no-renames",
        before, after, "--", *(f":(top,literal){owned_path}" for owned_path in owned_paths),
        allowed=(0, 1),
    ).returncode == 1
    return changed, "import-owned-change" if changed else "import-no-owned-change"


def main():
    try:
        publish, reason = release_admission(os.environ)
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"publish={str(publish).lower()}\nreason={reason}\n")
        print(f"Release admission: {reason}; publish={str(publish).lower()}")
    except (KeyError, OSError, ValueError) as error:
        print(f"Release admission failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
