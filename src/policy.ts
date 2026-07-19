import { isAbsolute, relative, resolve } from "node:path";
import type { Decision, PolicyResult, ToolAction } from "./types.ts";

const READ_ONLY_TOOLS = new Set([
  "glob",
  "grep",
  "find",
  "ls",
  "search",
  "web_fetch",
  "web_search",
]);

const FILE_READ_TOOLS = new Set(["read", "read_file", "view", "view_image"]);
const FILE_WRITE_TOOLS = new Set(["edit", "write", "write_file", "apply_patch"]);

const PATH_KEYS = new Set([
  "path",
  "file",
  "file_path",
  "filepath",
  "filename",
  "target",
  "directory",
  "dir",
  "cwd",
]);

const SENSITIVE_PATHS = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.config\/(gcloud|gh)(\/|$)/i,
  /(^|\/)\.kube\/config$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.env(?:\.[^/]*)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\/etc\/(shadow|sudoers)(\/|$)/i,
  /(^|\/)Library\/Keychains(\/|$)/i,
];

const PROTECTED_WRITE_PATHS = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.kube(\/|$)/i,
  /^\/etc(\/|$)/i,
  /^\/usr(\/|$)/i,
  /^\/System(\/|$)/i,
];

const ASK_COMMANDS: Array<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /\b(?:sudo|doas)\b/i, category: "privilege-escalation", reason: "uses elevated privileges" },
  { pattern: /\brm\b[^\n]*(?:\s-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b|--recursive\b|--force\b)/i, category: "destructive-filesystem", reason: "recursively or forcibly deletes files" },
  { pattern: /\b(?:chmod|chown)\b/i, category: "permission-change", reason: "changes filesystem ownership or permissions" },
  { pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f|checkout\s+--|restore\b[^\n]*--worktree)/i, category: "destructive-git", reason: "can discard uncommitted work" },
  { pattern: /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f\b)/i, category: "remote-mutation", reason: "force-pushes remote history" },
  { pattern: /\b(?:curl|wget)\b[^\n|]*(?:\||\>)[^\n]*(?:sh|bash|zsh|fish|python|node)\b/i, category: "remote-code-execution", reason: "downloads and executes remote content" },
  { pattern: /\b(?:npm|pnpm|yarn)\s+(?:publish|install|add|remove|uninstall)\b/i, category: "package-mutation", reason: "installs, removes, or publishes packages" },
  { pattern: /\b(?:pip|pip3|uv)\s+(?:install|uninstall|publish)\b/i, category: "package-mutation", reason: "installs, removes, or publishes packages" },
  { pattern: /\b(?:killall|pkill)\b|\bkill\s+-9\b/i, category: "process-control", reason: "forcibly terminates processes" },
  { pattern: /\b(?:docker\s+system\s+prune|kubectl\s+(?:delete|apply|replace)|terraform\s+(?:apply|destroy)|gh\s+pr\s+merge)\b/i, category: "external-side-effect", reason: "causes a broad or remote side effect" },
  { pattern: /\b(?:shutdown|reboot|halt|launchctl\s+(?:unload|bootout))\b/i, category: "system-control", reason: "changes system availability" },
];

const HARD_DENY_COMMANDS: Array<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /(?:^|[;&|]\s*)rm\s+(?:(?:-[^\s]*(?:r[^\s]*f|f[^\s]*r)[^\s]*|--recursive|--force)\s+)+(?:\/|\/\*|~|~\/\*|\$HOME|\$\{HOME\}|\.)(?=\s|[;&|]|$)/i, category: "catastrophic-delete", reason: "attempts to recursively delete a filesystem root, home, or the entire working directory" },
  { pattern: /\bmkfs(?:\.[a-z0-9]+)?\b|\bdd\b[^\n]*\bof=\/dev\//i, category: "disk-destruction", reason: "attempts to overwrite or format a disk device" },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, category: "resource-exhaustion", reason: "contains a fork bomb" },
];

const SAFE_SHELL_SEGMENT = /^(?:pwd|ls|tree|find|fd|rg|grep|head|tail|sed\s+-n|awk|wc|stat|file|du|df|which|type|command\s+-v|git\s+(?:status|diff|log|show|branch|rev-parse|ls-files|remote\s+-v)|npm\s+(?:test|run\s+(?:test|lint|check|typecheck)|view|info)|pnpm\s+(?:test|lint|typecheck)|yarn\s+(?:test|lint)|cargo\s+(?:test|check)|go\s+test|pytest|python\s+-m\s+pytest|node\s+--version)(?:\s|$)/i;

function decision(verdict: Decision["verdict"], reason: string, category: string): Decision {
  return { verdict, reason, category, source: "policy" };
}

function collectPaths(value: unknown, key = "", output: string[] = []): string[] {
  if (typeof value === "string" && PATH_KEYS.has(key.toLowerCase())) {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, key, output);
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      collectPaths(child, childKey, output);
    }
  }
  return output;
}

function isOutside(path: string, cwd: string): boolean {
  const target = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), target);
  return rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel);
}

function isSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some((pattern) => pattern.test(path));
}

function isProtectedWrite(path: string): boolean {
  return PROTECTED_WRITE_PATHS.some((pattern) => pattern.test(path));
}

function shellCommand(input: Record<string, unknown>): string {
  for (const key of ["command", "cmd", "script"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return "";
}

function isSafeShell(command: string): boolean {
  if (!command || /[`$]\(|\>\>?|\<\<?/.test(command)) return false;
  const segments = command.split(/(?:&&|\|\||\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  return segments.length > 0 && segments.every((segment) => SAFE_SHELL_SEGMENT.test(segment));
}

function containsSensitiveExfiltration(command: string): boolean {
  const hasSensitiveSource = SENSITIVE_PATHS.some((pattern) => pattern.test(command)) || /\b(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\b/.test(command);
  const hasNetworkSink = /\b(?:curl|wget|nc|ncat|netcat|scp|rsync|ssh)\b/i.test(command);
  return hasSensitiveSource && hasNetworkSink;
}

function deletesCriticalRoot(command: string): boolean {
  if (!/\brm\b[^\n]*(?:-[^\s]*(?:r[^\s]*f|f[^\s]*r)|--recursive|--force)/i.test(command)) return false;
  const unquoted = command.replace(/["']/g, "");
  return /(?:^|\s)(?:\/|\/\*|~|~\/\*|\$HOME|\$\{HOME\}|\.)(?=\s|[;&|]|$)/.test(unquoted);
}

function deletesWorkspaceRoot(command: string, cwd: string): boolean {
  if (!/\brm\b[^\n]*(?:-[^\s]*(?:r[^\s]*f|f[^\s]*r)|--recursive|--force)/i.test(command)) return false;
  const escaped = resolve(cwd).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)["']?${escaped}\/?["']?(?=\\s|[;&|]|$)`).test(command);
}

export function evaluatePolicy(action: ToolAction): PolicyResult {
  const tool = action.toolName.toLowerCase();
  const paths = collectPaths(action.input);

  if (tool === "bash" || tool === "shell" || tool === "exec" || tool === "exec_command") {
    const command = shellCommand(action.input);
    if (!command) return { verdict: "classify", reason: "shell-like tool has no recognizable command field" };

    if (containsSensitiveExfiltration(command)) {
      return decision("deny", "command combines credential-like data with a network transfer", "credential-exfiltration");
    }
    if (deletesCriticalRoot(command)) {
      return decision("deny", "attempts to recursively delete a filesystem root, home, or the entire working directory", "catastrophic-delete");
    }
    if (deletesWorkspaceRoot(command, action.cwd)) {
      return decision("deny", "attempts to recursively delete the entire working directory", "catastrophic-delete");
    }
    for (const rule of HARD_DENY_COMMANDS) {
      if (rule.pattern.test(command)) return decision("deny", rule.reason, rule.category);
    }
    for (const rule of ASK_COMMANDS) {
      if (rule.pattern.test(command)) return decision("ask", rule.reason, rule.category);
    }
    if (isSafeShell(command)) {
      return decision("allow", "command is composed only of known read-only operations", "read-only-shell");
    }
    return { verdict: "classify", reason: "shell command is not covered by a deterministic rule" };
  }

  if (FILE_READ_TOOLS.has(tool)) {
    if (paths.length === 0) return { verdict: "classify", reason: "file-reading tool has no recognizable path field" };
    if (paths.some(isSensitive)) return decision("ask", "reads a credential or secret-bearing path", "sensitive-read");
    if (paths.some((path) => isOutside(path, action.cwd))) return decision("ask", "reads outside the current workspace", "outside-workspace-read");
    return decision("allow", "read-only file inspection", "read-only-tool");
  }

  if (READ_ONLY_TOOLS.has(tool)) {
    if (paths.some(isSensitive)) return decision("ask", "inspects a credential or secret-bearing path", "sensitive-read");
    if (paths.some((path) => isOutside(path, action.cwd))) return decision("ask", "inspects outside the current workspace", "outside-workspace-read");
    return decision("allow", "known read-only tool", "read-only-tool");
  }

  if (FILE_WRITE_TOOLS.has(tool)) {
    if (paths.length === 0) return { verdict: "classify", reason: "file-writing tool has no recognizable path field" };
    if (paths.some(isProtectedWrite)) return decision("deny", "writes to protected security or repository metadata", "protected-path-write");
    if (paths.some((path) => isOutside(path, action.cwd))) return decision("ask", "writes outside the current workspace", "outside-workspace-write");
    return decision("allow", "workspace-local code edit", "workspace-edit");
  }

  return { verdict: "classify", reason: "unknown or side-effecting tool" };
}
