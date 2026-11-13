#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash and PowerShell tools).
//
// - Any command that uses --no-verify is blocked outright.
// - Any `git commit` runs `npm run check` first; if the check fails the commit is blocked.
// - Every other command passes through untouched.
//
// Exit codes (Claude Code hook contract): 0 = allow, 2 = block (stderr is shown to Claude).
// Configured in .claude/settings.json. Do not remove or work around it.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// git global options that take a separate value: `git -C <path> commit`, `git -c k=v commit`
const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

/**
 * Split a shell command line into simple commands (on ; && || | and newlines),
 * then into words, honouring single and double quotes. Good enough to find
 * `git ... commit` reliably without a full shell parser.
 *
 * @param {string} command
 * @returns {string[][]}
 */
export function splitCommands(command) {
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      endCommand();
    } else if (ch === "(" || ch === ")" || ch === "{" || ch === "}") {
      endWord();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/**
 * @param {string[]} words one simple command
 * @returns {number} index of the git subcommand, or -1 if this is not a git invocation
 */
function gitSubcommandIndex(words) {
  // The command word is the first word after any `VAR=value` prefixes.
  let gitAt = 0;
  while (gitAt < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[gitAt])) gitAt += 1;
  if (gitAt >= words.length || !/(^|[\\/])git(\.exe)?$/i.test(words[gitAt])) return -1;
  let i = gitAt + 1;
  while (i < words.length && words[i].startsWith("-")) {
    i += GIT_OPTS_WITH_VALUE.has(words[i]) ? 2 : 1;
  }
  return i < words.length ? i : -1;
}

const CD_COMMANDS = new Set(["cd", "pushd", "set-location", "sl", "chdir"]);

/**
 * @param {string} command full command string from tool_input.command
 * @returns {{ isCommit: boolean, noVerify: boolean, commitDir: string | null }}
 *   commitDir: where the commit runs, relative to the shell's starting directory
 *   (from `cd <dir> && git commit` and/or `git -C <dir> commit`); null = the starting directory.
 */
export function analyzeCommand(command) {
  let isCommit = false;
  let noVerify = false;
  let commitDir = null;
  let cdDir = null;
  for (const words of splitCommands(command)) {
    if (words.includes("--no-verify")) noVerify = true;
    if (CD_COMMANDS.has(words[0]?.toLowerCase()) && words[1] && !words[1].startsWith("-")) {
      cdDir = cdDir ? path.join(cdDir, words[1]) : words[1];
      if (path.isAbsolute(words[1])) cdDir = words[1];
      continue;
    }
    const sub = gitSubcommandIndex(words);
    if (sub === -1 || words[sub] !== "commit") continue;
    isCommit = true;
    commitDir = cdDir;
    const c = words.indexOf("-C");
    if (c !== -1 && c < sub && words[c + 1]) {
      const dashC = words[c + 1];
      commitDir = path.isAbsolute(dashC) || !commitDir ? dashC : path.join(commitDir, dashC);
    }
    // `git commit -n` / `-an` / `-nm "msg"` is the short form of --no-verify.
    for (const w of words.slice(sub + 1)) {
      if (w === "--") break;
      if (/^-[a-zA-Z]+$/.test(w) && w.includes("n")) noVerify = true;
    }
  }
  return { isCommit, noVerify, commitDir };
}

/**
 * Root of the git repo/worktree that a commit in `dir` would land in, or null if `dir` isn't
 * inside one. With git worktrees this is the worktree, not the main checkout.
 *
 * @param {string} dir
 * @returns {string | null}
 */
export function repoRoot(dir) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  return result.status === 0 ? path.resolve(result.stdout.trim()) : null;
}

/**
 * Windows editors (e.g. VS Code) can report the project dir as `c:\...`. Running Vitest from a
 * lowercase-drive cwd loads two copies of Vitest and every suite crashes, so normalise to `C:\...`.
 *
 * @param {string} dir
 * @returns {string}
 */
export function normalizeCwd(dir) {
  return dir.replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    process.stderr.write(`pre-commit-check: could not parse hook input: ${error}\n`);
    process.exit(2);
  }

  const command = input?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);

  const { isCommit, noVerify, commitDir } = analyzeCommand(command);

  if (noVerify) {
    process.stderr.write(
      "Blocked: --no-verify (or git commit -n) is not allowed in this repo. Fix the failing check instead.\n",
    );
    process.exit(2);
  }
  if (!isCommit) process.exit(0);

  // Check the repo the commit actually targets (cd / git -C / a git worktree), not just the
  // directory the session started in.
  const start = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const target = commitDir ? path.resolve(start, commitDir) : start;
  const cwd = normalizeCwd(repoRoot(target) ?? process.env.CLAUDE_PROJECT_DIR ?? start);
  process.stderr.write(`pre-commit-check: running \`npm run check\` in ${cwd} before git commit...\n`);
  const result = spawnSync("npm run check", {
    cwd,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status === 0) process.exit(0);

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const tail = output.split("\n").slice(-60).join("\n");
  process.stderr.write(
    `Blocked: \`npm run check\` failed (exit ${result.status ?? result.signal ?? result.error}). ` +
      "Fix the code, then commit again.\n\n" +
      tail +
      "\n",
  );
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
