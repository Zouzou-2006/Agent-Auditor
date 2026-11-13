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

/**
 * @param {string} command full command string from tool_input.command
 * @returns {{ isCommit: boolean, noVerify: boolean }}
 */
export function analyzeCommand(command) {
  let isCommit = false;
  let noVerify = false;
  for (const words of splitCommands(command)) {
    if (words.includes("--no-verify")) noVerify = true;
    const sub = gitSubcommandIndex(words);
    if (sub === -1 || words[sub] !== "commit") continue;
    isCommit = true;
    // `git commit -n` / `-an` / `-nm "msg"` is the short form of --no-verify.
    for (const w of words.slice(sub + 1)) {
      if (w === "--") break;
      if (/^-[a-zA-Z]+$/.test(w) && w.includes("n")) noVerify = true;
    }
  }
  return { isCommit, noVerify };
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

  const { isCommit, noVerify } = analyzeCommand(command);

  if (noVerify) {
    process.stderr.write(
      "Blocked: --no-verify (or git commit -n) is not allowed in this repo. Fix the failing check instead.\n",
    );
    process.exit(2);
  }
  if (!isCommit) process.exit(0);

  const cwd = normalizeCwd(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  process.stderr.write("pre-commit-check: running `npm run check` before git commit...\n");
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
