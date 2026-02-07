import { exec as execCommand } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type LocalToolParams = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  workspaceRoot?: string;
};

type TextContent = { type: "text"; text: string };

const MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

const LOCAL_TOOLS = new Set([
  "exec",
  "read",
  "write",
  "edit",
  "list_dir",
  "pwd",
  "whoami",
]);

export const isLocalTool = (toolName: string) => LOCAL_TOOLS.has(toolName);

const toStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") {
      record[key] = val;
    }
  }
  return record;
};

const resolveWorkdir = (args: Record<string, unknown>, workspaceRoot?: string) => {
  const raw =
    typeof args.workdir === "string"
      ? args.workdir
      : typeof args.cwd === "string"
        ? args.cwd
        : undefined;
  if (raw && raw.trim()) {
    return path.resolve(raw);
  }
  if (workspaceRoot && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot);
  }
  return process.cwd();
};

const resolvePathArg = (args: Record<string, unknown>, workspaceRoot?: string) => {
  const raw =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : typeof args.target === "string"
          ? args.target
          : "";
  if (!raw.trim()) {
    throw new Error("Missing path argument.");
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  if (workspaceRoot && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot, raw);
  }
  return path.resolve(raw);
};

const buildTextResult = (text: string, details?: Record<string, unknown>) => ({
  content: [{ type: "text", text }] as TextContent[],
  details,
});

const runExec = async (args: Record<string, unknown>, workspaceRoot?: string) => {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command.trim()) {
    throw new Error("exec requires a command.");
  }
  const timeoutMs =
    typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
      ? Math.max(1, Math.floor(args.timeoutMs))
      : typeof args.timeoutSec === "number" && Number.isFinite(args.timeoutSec)
        ? Math.max(1, Math.floor(args.timeoutSec * 1000))
        : DEFAULT_EXEC_TIMEOUT_MS;
  const env = { ...process.env, ...toStringRecord(args.env) };
  const cwd = resolveWorkdir(args, workspaceRoot);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    execCommand(
      command,
      {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 0;
        const signal =
          error && typeof (error as { signal?: unknown }).signal === "string"
            ? (error as { signal: string }).signal
            : undefined;
        const timedOut = Boolean(
          error && (error as { killed?: boolean }).killed && signal,
        );

        if (error && typeof (error as { code?: unknown }).code !== "number") {
          reject(error);
          return;
        }

        const output =
          stdout?.toString().trim() ||
          stderr?.toString().trim() ||
          "(no output)";
        resolve(
          buildTextResult(output, {
            command,
            cwd,
            exitCode,
            signal,
            timedOut,
            durationMs,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            error: error ? String(error.message ?? error) : undefined,
          }),
        );
      },
    );
  });
};

const runRead = async (args: Record<string, unknown>, workspaceRoot?: string) => {
  const target = resolvePathArg(args, workspaceRoot);
  const offset = typeof args.offset === "number" ? Math.max(0, Math.floor(args.offset)) : 0;
  const limit = typeof args.limit === "number" ? Math.max(0, Math.floor(args.limit)) : undefined;
  const buffer = await fs.readFile(target);
  const rawText = buffer.toString("utf8");
  const lines = rawText.split("\n");
  const startIndex = Math.max(0, offset ? offset - 1 : 0);
  const sliced = limit !== undefined ? lines.slice(startIndex, startIndex + limit) : lines.slice(startIndex);
  let text = sliced.join("\n");
  let truncated = false;
  if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
    truncated = true;
    text = text.slice(0, MAX_OUTPUT_BYTES);
  }
  const suffix = truncated
    ? `\n\n[Output truncated at ${MAX_OUTPUT_BYTES} bytes.]`
    : "";
  return buildTextResult(`${text}${suffix}`, {
    path: target,
    totalLines: lines.length,
    offset: offset || 0,
    limit,
    truncated,
  });
};

const runWrite = async (args: Record<string, unknown>, workspaceRoot?: string) => {
  const target = resolvePathArg(args, workspaceRoot);
  const content = typeof args.content === "string" ? args.content : "";
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return buildTextResult(`Wrote ${content.length} bytes to ${target}.`, {
    path: target,
    bytes: content.length,
  });
};

const runEdit = async (args: Record<string, unknown>, workspaceRoot?: string) => {
  const target = resolvePathArg(args, workspaceRoot);
  const oldText = typeof args.oldText === "string" ? args.oldText : "";
  const newText = typeof args.newText === "string" ? args.newText : "";
  if (!oldText) {
    throw new Error("edit requires oldText.");
  }
  const raw = await fs.readFile(target, "utf8");
  const occurrences = raw.split(oldText).length - 1;
  if (occurrences === 0) {
    throw new Error(`No match found for oldText in ${target}.`);
  }
  if (occurrences > 1) {
    throw new Error(`Multiple matches found for oldText in ${target}. Provide a unique match.`);
  }
  const updated = raw.replace(oldText, newText);
  await fs.writeFile(target, updated, "utf8");
  return buildTextResult(`Updated ${target}.`, { path: target });
};

const runListDir = async (args: Record<string, unknown>, workspaceRoot?: string) => {
  const rawPath =
    typeof args.path === "string"
      ? args.path
      : typeof args.dir === "string"
        ? args.dir
        : typeof args.cwd === "string"
          ? args.cwd
          : "";
  const target = rawPath.trim()
    ? resolvePathArg({ path: rawPath }, workspaceRoot)
    : resolveWorkdir({}, workspaceRoot);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const items = entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
  }));
  const lines = items.map((item) => (item.type === "dir" ? `[dir] ${item.name}` : item.name));
  const text = lines.length ? lines.join("\n") : "(empty)";
  return buildTextResult(text, { path: target, entries: items, count: items.length });
};

const runPwd = async (_args: Record<string, unknown>, workspaceRoot?: string) => {
  const cwd = workspaceRoot && workspaceRoot.trim() ? path.resolve(workspaceRoot) : process.cwd();
  return buildTextResult(cwd, { cwd });
};

const runWhoAmI = async () => {
  const info = os.userInfo();
  return buildTextResult(info.username, { username: info.username });
};

export async function invokeLocalTool(params: LocalToolParams): Promise<unknown> {
  switch (params.toolName) {
    case "exec":
      return runExec(params.toolArgs, params.workspaceRoot);
    case "read":
      return runRead(params.toolArgs, params.workspaceRoot);
    case "write":
      return runWrite(params.toolArgs, params.workspaceRoot);
    case "edit":
      return runEdit(params.toolArgs, params.workspaceRoot);
    case "list_dir":
      return runListDir(params.toolArgs, params.workspaceRoot);
    case "pwd":
      return runPwd(params.toolArgs, params.workspaceRoot);
    case "whoami":
      return runWhoAmI();
    default:
      throw new Error(`Unsupported local tool: ${params.toolName}`);
  }
}
