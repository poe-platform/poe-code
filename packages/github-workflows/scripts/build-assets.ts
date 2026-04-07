import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGithubWorkflowPackageAssetCopies } from "../../../scripts/bundle-assets.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist");

await Promise.all(
  resolveGithubWorkflowPackageAssetCopies(packageDir, distDir).map(
    async ({ sourceDir, targetDir, extension }) => {
      await mkdir(targetDir, { recursive: true });
      const files = (await readdir(sourceDir)).filter((file) => file.endsWith(extension));
      await Promise.all(
        files.map((file) => copyFile(path.join(sourceDir, file), path.join(targetDir, file)))
      );
    }
  )
);
