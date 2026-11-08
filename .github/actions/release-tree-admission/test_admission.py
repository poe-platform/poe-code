import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="release-admission-test-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.directory = Path(cls.temporary.name)
        cls.repository = cls.directory / "repository"
        cls.environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("GIT_", "GITHUB_", "RELEASE_"))
        }
        cls.environment.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        cls.git("init", "--quiet", "--template=", str(cls.repository), cwd=cls.directory)
        stream = bytearray()
        marks = {}

        def commit(name, parents=(), files=None, branch=None):
            mark = len(marks) + 1
            marks[name] = mark
            stream.extend((
                f"commit refs/heads/{branch or name}\nmark :{mark}\n"
                "committer Fixture <fixture@example.invalid> 1700000000 +0000\n"
                f"data {len(name)}\n{name}\n"
            ).encode())
            for index, parent in enumerate(parents):
                stream.extend(f"{'from' if index == 0 else 'merge'} :{marks[parent]}\n".encode())
            for filename, content in (files or {}).items():
                if content is None:
                    stream.extend(f"D {filename}\n".encode())
                else:
                    data = content.encode()
                    stream.extend(f"M 100644 inline {filename}\ndata {len(data)}\n".encode())
                    stream.extend(data + b"\n")
            stream.extend(b"\n")

        commit("base", files={
            "packages/widget/index.js": "original\n",
            "packages/literal[1]/index.js": "literal\n",
            "package.json": "original manifest\n",
            "package-lock.json": "original lock\n",
            ".github/workflows/release-widget.yml": "original workflow\n",
            "scripts/widget-build.mjs": "original helper\n",
        })
        commit("ordinary", ("base",), {"packages/widget/index.js": "changed\n"})
        commit("shared", ("base",), {"package.json": "changed manifest\n", "package-lock.json": "changed lock\n"})
        commit("workflow", ("base",), {".github/workflows/release-widget.yml": "changed workflow\n"})
        commit("normal-merge", ("ordinary", "shared"))
        commit("source", files={"source.js": "unrelated source\n"})
        commit("import", ("base", "source"), {"packages/safe-bash/source.js": "unrelated source\n"})
        commit("import-shared", ("base", "source"), {"package-lock.json": "changed lock\n"})
        commit("import-workflow", ("base", "source"), {".github/workflows/release-widget.yml": "guard installation\n"})
        commit("import-owned", ("base", "source"), {"packages/widget/index.js": "changed\n"})
        commit("import-helper", ("base", "source"), {"scripts/widget-build.mjs": "changed helper\n"})
        commit("import-lookalike", ("base", "source"), {"packages/widget-other/index.js": "lookalike\n"})
        commit("import-delete", ("base", "source"), {"packages/widget/index.js": None})
        commit("import-literal", ("base", "source"), {"packages/literal[1]/index.js": "changed literal\n"})
        commit("next", ("import",), {"package-lock.json": "next shared change\n"})
        commit("source-next", ("source",), {"source.js": "next source\n"})
        commit("repeat-import", ("import", "source-next"))
        commit("third-root", files={"third.js": "third root\n"})
        commit("octopus", ("base", "source", "third-root"))
        commit("reversed", ("source", "base"), {"packages/widget/index.js": "original\n"})
        previous = "base"
        for number in range(1002):
            name = f"large-{number}"
            commit(name, (previous,), {"package-lock.json": f"shared update {number}\n"}, branch="large")
            previous = name
        mark_file = cls.directory / "marks"
        cls.git("fast-import", "--quiet", f"--export-marks={mark_file}", input=bytes(stream))
        objects = dict(line.split() for line in mark_file.read_text().splitlines())
        cls.commits = {name: objects[f":{mark}"] for name, mark in marks.items()}
        cls.helper = Path(__file__).with_name("admission.py")

    @classmethod
    def git(cls, *arguments, cwd=None, input=None):
        result = subprocess.run(
            ["git", *arguments], cwd=cwd or cls.repository,
            env=cls.environment, input=input, capture_output=True, check=True,
        )
        return result.stdout.decode().strip()

    def run_admission(self, after="ordinary", before="base", event=None, context=None,
                      paths="packages/widget", checkout=None, repository=None, raw_event=None):
        repository = repository or self.repository
        self.git("checkout", "--quiet", "--detach", self.commits[checkout or after], cwd=repository)
        payload = {
            "before": self.commits[before], "after": self.commits[after],
            "ref": "refs/heads/main",
        } if event is None else event
        event_file = self.directory / "event.json"
        event_file.write_text(json.dumps(payload) if raw_event is None else raw_event)
        output_file = self.directory / "output"
        output_file.write_text("")
        environment = {
            **self.environment,
            "GITHUB_WORKSPACE": str(repository),
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_EVENT_PATH": str(event_file),
            "GITHUB_SHA": self.commits[after],
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_OUTPUT": str(output_file),
            "RELEASE_OWNED_PATHS": paths,
            **(context or {}),
        }
        result = subprocess.run(
            [sys.executable, "-B", str(self.helper)], cwd=repository,
            env=environment, capture_output=True, text=True,
        )
        return result, output_file.read_text()

    def assert_admission(self, expected, reason, **options):
        result, output = self.run_admission(**options)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"publish={str(expected).lower()}\n", output)
        self.assertIn(f"reason={reason}\n", output)

    def assert_rejected(self, **options):
        result, output = self.run_admission(**options)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release admission failed:", result.stderr)
        self.assertEqual(output, "")

    def test_ordinary_owned_change(self):
        self.assert_admission(True, "ordinary-push")

    def test_ordinary_shared_change(self):
        self.assert_admission(True, "ordinary-push", after="shared")

    def test_ordinary_workflow_change(self):
        self.assert_admission(True, "ordinary-push", after="workflow")

    def test_ordinary_merge(self):
        self.assert_admission(True, "ordinary-push", after="normal-merge")

    def test_more_than_1000_ordinary_commits(self):
        count = self.git("rev-list", "--count", f"{self.commits['base']}..{self.commits['large-1001']}")
        self.assertEqual(count, "1002")
        self.assert_admission(True, "ordinary-push", after="large-1001")

    def test_unrelated_import(self):
        self.assert_admission(False, "import-no-owned-change", after="import")

    def test_import_shared_only(self):
        self.assert_admission(False, "import-no-owned-change", after="import-shared")

    def test_import_workflow_only(self):
        self.assert_admission(False, "import-no-owned-change", after="import-workflow")

    def test_import_owned_source_change(self):
        self.assert_admission(True, "import-owned-change", after="import-owned")

    def test_import_helper_change(self):
        self.assert_admission(True, "import-owned-change", after="import-helper", paths="scripts/widget-build.mjs")

    def test_import_owned_deletion(self):
        self.assert_admission(True, "import-owned-change", after="import-delete")

    def test_import_lookalike_path(self):
        self.assert_admission(False, "import-no-owned-change", after="import-lookalike")

    def test_import_literal_path(self):
        self.assert_admission(True, "import-owned-change", after="import-literal", paths="packages/literal[1]")

    def test_import_multiple_owned_paths(self):
        self.assert_admission(True, "import-owned-change", after="import-helper", paths="packages/widget\nscripts/widget-build.mjs")

    def test_import_includes_later_commit(self):
        self.assert_admission(False, "import-no-owned-change", after="next")

    def test_next_push_restores_shared_behavior(self):
        self.assert_admission(True, "ordinary-push", after="next", before="import")

    def test_already_connected_source_merge_is_ordinary(self):
        self.assert_admission(True, "ordinary-push", after="repeat-import", before="import")

    def test_octopus_import(self):
        self.assert_admission(False, "import-no-owned-change", after="octopus")

    def test_reversed_import_parents(self):
        self.assert_admission(False, "import-no-owned-change", after="reversed")

    def test_dispatch_selected_branch_and_tag(self):
        for reference in ("refs/heads/topic", "refs/tags/v1"):
            for event_ref in (reference, reference.split("/", 2)[2]):
                with self.subTest(reference=reference, event_ref=event_ref):
                    self.assert_admission(True, "manual-dispatch", after="import",
                        event={"ref": event_ref, "inputs": {}},
                        context={"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": reference})

    def test_invalid_dispatch(self):
        for event in ({}, {"ref": "wrong"}, {"ref": None}, []):
            with self.subTest(event=event):
                self.assert_rejected(event=event, context={"GITHUB_EVENT_NAME": "workflow_dispatch"})

    def test_dispatch_checkout_mismatch(self):
        self.assert_rejected(event={"ref": "main"}, checkout="base",
            context={"GITHUB_EVENT_NAME": "workflow_dispatch"})

    def test_shallow_repository(self):
        with tempfile.TemporaryDirectory(dir=self.directory) as temporary:
            clone = Path(temporary) / "shallow"
            self.git("clone", "--quiet", "--depth=1", "--branch=ordinary", self.repository.as_uri(), str(clone))
            self.assert_rejected(repository=clone)

    def test_non_fast_forward(self):
        self.assert_rejected(before="ordinary", after="shared")

    def test_checkout_mismatch(self):
        self.assert_rejected(checkout="base")

    def test_event_sha_mismatch(self):
        self.assert_rejected(context={"GITHUB_SHA": self.commits["base"]})

    def test_event_ref_mismatch(self):
        self.assert_rejected(context={"GITHUB_REF": "refs/heads/other"})

    def test_invalid_before_or_after(self):
        for field in ("before", "after"):
            for invalid in (None, "", "0" * 40, "f" * 40, "HEAD", "--all"):
                event = {"before": self.commits["base"], "after": self.commits["ordinary"], "ref": "refs/heads/main"}
                event[field] = invalid
                with self.subTest(field=field, invalid=invalid):
                    self.assert_rejected(event=event)

    def test_unsupported_event(self):
        self.assert_rejected(context={"GITHUB_EVENT_NAME": "pull_request"})

    def test_malformed_payload(self):
        self.assert_rejected(raw_event="{")

    def test_invalid_owned_paths(self):
        for paths in ("", ".", "../packages/widget", "/packages/widget", "packages/../widget", "package.json"):
            with self.subTest(paths=paths):
                self.assert_rejected(after="import", paths=paths)

    def test_caller_flags_cannot_admit_import(self):
        self.assert_admission(False, "import-no-owned-change", after="import",
            context={"FORCE_RELEASE": "true", "SKIP_IMPORT_GUARD": "true"})

    def test_inherited_graft_file_is_rejected(self):
        graft = self.directory / "grafts"
        graft.write_text(f"{self.commits['import']} {self.commits['base']}\n")
        self.assert_rejected(after="import", context={"GIT_GRAFT_FILE": str(graft)})

    def test_inherited_pathspec_override_is_rejected(self):
        self.assert_admission(True, "import-owned-change", after="import-owned")
        self.assert_rejected(after="import-owned", context={"GIT_LITERAL_PATHSPECS": "1"})

    def test_malformed_push_reference_is_rejected(self):
        reference = "refs/heads/invalid..name"
        self.assert_rejected(
            event={"before": self.commits["base"], "after": self.commits["ordinary"], "ref": reference},
            context={"GITHUB_REF": reference},
        )

    def test_malformed_dispatch_reference_is_rejected(self):
        reference = "refs/heads/invalid..name"
        self.assert_rejected(after="import", event={"ref": reference},
            context={"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": reference})

    def test_inherited_repository_history_and_pathspec_controls_are_rejected(self):
        for variable in (
            "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE",
            "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
            "GIT_SHALLOW_FILE", "GIT_REPLACE_REF_BASE", "GIT_CONFIG", "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0",
            "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS",
        ):
            with self.subTest(variable=variable):
                self.assert_rejected(after="import", context={variable: "1"})

    def test_local_grafts_cannot_hide_imported_history(self):
        graft = self.repository / ".git" / "info" / "grafts"
        graft.parent.mkdir(exist_ok=True)
        graft.write_text(f"{self.commits['import']} {self.commits['base']}\n")
        try:
            self.assert_admission(False, "import-no-owned-change", after="import")
        finally:
            graft.unlink()

    def test_queued_dispatch_does_not_require_current_branch_tip(self):
        self.assert_admission(True, "manual-dispatch", after="base", event={"ref": "import"},
            context={"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/import"})

    def test_queued_push_does_not_require_current_branch_tip(self):
        reference = "refs/heads/normal-merge"
        self.assert_admission(True, "ordinary-push",
            event={"before": self.commits["base"], "after": self.commits["ordinary"], "ref": reference},
            context={"GITHUB_REF": reference})


if __name__ == "__main__":
    unittest.main()
