"""Run with the Safe Bash Python launcher, configured standard commands and rg, and /project files."""
import subprocess
from poe_shell import Client
from pyodide.ffi import run_sync

result = subprocess.run(
    ["rg", "TODO", "/project"], capture_output=True, text=True, check=True
)
assert "TODO" in result.stdout
assert subprocess.check_output("printf x | cat", shell=True) == b"x"
with open("/work/example-input.bin", "wb") as output:
    output.write(bytes([255, 0, 42]))
subprocess.run(
    "cat example-input.bin > example-copy.bin", shell=True, cwd="/work", check=True
)
with open("/work/example-copy.bin", "rb") as source:
    assert source.read() == bytes([255, 0, 42])


async def main():
    async with Client() as shell:
        result = await shell.run(["echo", "literal $(value)"])
        assert result.stdout == b"literal $(value)\n"
        assert result.stderr == b"" and result.returncode == 0


run_sync(main())
print("shell-example-ok")
