import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(repoRoot, "openclaw", "node_modules");
const targetDir = path.join(repoRoot, "openclaw", "node_modules_materialized");

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  if (!(await exists(sourceDir))) {
    console.error(`OpenClaw node_modules not found at ${sourceDir}`);
    process.exit(1);
  }

  await fs.mkdir(targetDir, { recursive: true });

  if (process.platform === "win32") {
    const args = [
      sourceDir,
      targetDir,
      "/MIR",
      "/FFT",
      "/R:1",
      "/W:1",
      "/MT:8",
      "/XD",
      ".pnpm",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NC",
      "/NS",
      "/NP",
    ];
    const code = await new Promise((resolve) => {
      const proc = spawn("robocopy", args, { stdio: "inherit" });
      proc.on("close", (exitCode) => resolve(exitCode ?? 1));
      proc.on("error", () => resolve(1));
    });
    if (code > 7) {
      throw new Error(`robocopy failed with exit code ${code}`);
    }
  } else {
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      dereference: true,
      force: true,
      errorOnExist: false,
    });
  }

  console.log(`Materialized OpenClaw node_modules at ${targetDir}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
