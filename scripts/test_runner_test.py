import os
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import scripts.test_runner as test_runner


class RunCommandsTest(unittest.TestCase):
  def test_prepends_home_reset_before_each_group(self) -> None:
    fake_runner = Path("/tmp/colima-runner.sh")
    command_groups = [
      ["cmd one", "cmd two"],
      ["cmd three"],
    ]
    reset_cmd = "rm -rf ~/.poe-code && mkdir -p ~/.poe-code/logs"

    with (
      patch.object(test_runner, "COMMAND_GROUPS", command_groups),
      patch("scripts.test_runner.colima_runner_path", return_value=fake_runner),
      patch("scripts.test_runner.load_local_api_key", return_value="test-key"),
      patch("scripts.test_runner.subprocess.run") as mocked_run,
      patch("builtins.print"),
      patch.dict(os.environ, {"RUNNER_DOCKER_ARGS": ""}, clear=True),
    ):
      test_runner.run_commands()

    self.assertEqual(mocked_run.call_count, len(command_groups))

    for call, expected_commands in zip(mocked_run.call_args_list, command_groups):
      args, kwargs = call
      self.assertEqual(
        args[0],
        [str(fake_runner), reset_cmd, "poe-code login --api-key test-key", *expected_commands],
      )
      self.assertTrue(kwargs["check"])
      self.assertEqual(
        kwargs["env"]["RUNNER_DOCKER_ARGS"],
        "-e POE_CODE_STDERR_LOGS=1 -e POE_API_KEY",
      )
      self.assertEqual(
        kwargs["env"]["COLIMA_DOCKER_ARGS"],
        "-e POE_CODE_STDERR_LOGS=1 -e POE_API_KEY",
      )
      self.assertEqual(kwargs["env"]["POE_API_KEY"], "test-key")

  def test_redacts_api_key_in_failure_message(self) -> None:
    fake_error = test_runner.subprocess.CalledProcessError(
      1,
      [
        "scripts/colima-runner.sh",
        "poe-code login --api-key test-key",
      ],
    )

    stderr = StringIO()
    with (
      patch("scripts.test_runner.run_commands", side_effect=fake_error),
      patch("sys.stderr", stderr),
    ):
      exit_code = test_runner.main()

    self.assertEqual(exit_code, 1)
    self.assertIn("poe-code login --api-key ***", stderr.getvalue())
    self.assertNotIn("test-key", stderr.getvalue())

  def test_isolated_and_non_isolated_runs_are_separate(self) -> None:
    providers = ["claude-code", "codex", "opencode"]

    for provider in providers:
      has_isolated = False
      has_non_isolated = False

      for group in test_runner.COMMAND_GROUPS:
        group_has_configure = any(
          cmd.startswith("poe-code configure ") for cmd in group
        )
        for cmd in group:
          if not cmd.startswith(f"poe-code test {provider}"):
            continue
          if "--isolated" in cmd:
            has_isolated = True
            self.assertFalse(group_has_configure)
          else:
            has_non_isolated = True

      self.assertTrue(has_isolated)
      self.assertTrue(has_non_isolated)


if __name__ == "__main__":
  unittest.main()
