import { copyFile, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGithubWorkflowPackageAssetCopies } from "../../../scripts/bundle-assets.mjs";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist");

type AssetFileSystem = Pick<typeof import("node:fs/promises"), "copyFile" | "lstat" | "mkdir" | "readdir" | "realpath">;

export async function buildGithubWorkflowAssets(options: {
  packageDir?: string;
  distDir?: string;
  fs?: AssetFileSystem;
} = {}): Promise<void> {
  const selectedPackageDir = options.packageDir ?? packageDir;
  const selectedDistDir = options.distDir ?? distDir;
  const fs = options.fs ?? { copyFile, lstat, mkdir, readdir, realpath };

  await Promise.all(
    resolveGithubWorkflowPackageAssetCopies(selectedPackageDir, selectedDistDir).map(
      async ({ sourceDir, targetDir, extension }) => {
        await assertSafeOutputDirectory(selectedPackageDir, targetDir, fs);
        await fs.mkdir(targetDir, { recursive: true });
        const files = (await fs.readdir(sourceDir)).filter((file) => file.endsWith(extension));
        await Promise.all(
          files.map((file) => fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file)))
        );
      }
    )
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildGithubWorkflowAssets();
}
