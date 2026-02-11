import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");

const pkgPath = path.join(appDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;

const userArgs = process.argv.slice(2);
const hasOutputOverride = userArgs.some((arg) =>
  arg.startsWith("--config.directories.output"),
);
const outputArg = `--config.directories.output=dist/release-${version}`;
const args = hasOutputOverride ? userArgs : [...userArgs, outputArg];

const command = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
const result = spawnSync(command, args, {
  cwd: appDir,
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
