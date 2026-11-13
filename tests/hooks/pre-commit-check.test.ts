import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeCommand, normalizeCwd, repoRoot } from "../../.claude/hooks/pre-commit-check.mjs";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/pre-commit-check.mjs", import.meta.url));

describe("analyzeCommand: detects git commit", () => {
  it.each([
    'git commit -m "bootstrap"',
    "git commit",
    "git -C /repo commit -m x",
    "git -c user.name=x commit -m y",
    "cd repo && git commit -m x",
    "npm run check; git commit -am x",
    "/usr/bin/git commit -m x",
    "git.exe commit -m x",
    "git commit -m @'\nmulti line\n'@",
  ])("%s", (command) => {
    expect(analyzeCommand(command).isCommit).toBe(true);
  });
});

describe("analyzeCommand: ignores everything else", () => {
  it.each([
    "git status",
    "git log --oneline -5",
    "git diff --staged",
    'git log --grep "commit"',
    "echo git commit",
    'echo "git commit -m x"',
    "npm run check",
    "ls commit",
    "git add package.json",
    "git push -u origin main",
  ])("%s", (command) => {
    expect(analyzeCommand(command)).toEqual({ isCommit: false, noVerify: false, commitDir: null });
  });
});

describe("analyzeCommand: finds the directory the commit runs in", () => {
  it.each([
    ["git commit -m x", null],
    ["cd ../other-worktree && git commit -m x", "../other-worktree"],
    ['cd "c:/Users/me/repo-b" && git commit -m x', "c:/Users/me/repo-b"],
    ["git -C ../repo-b commit -m x", "../repo-b"],
    ["cd parent && git -C child commit -m x", "parent/child".replace("/", path.sep)],
    ["Set-Location ..\\repo-b; git commit -m x", "..\\repo-b"],
    ["cd a && cd b && git commit -m x", ["a", "b"].join(path.sep)],
    ["git status && git commit -m x", null],
  ])("%s -> %s", (command, expected) => {
    expect(analyzeCommand(command).commitDir).toBe(expected);
  });
});

describe("repoRoot", () => {
  it("resolves the repo root from a subdirectory", () => {
    const root = repoRoot(fileURLToPath(new URL("../../lib", import.meta.url)));
    expect(root).toBe(path.resolve(fileURLToPath(new URL("../..", import.meta.url))));
  });
});

describe("analyzeCommand: flags --no-verify", () => {
  it.each([
    "git commit --no-verify -m x",
    "git commit -n -m x",
    "git commit -nm x",
    "git commit -an -m x",
    "git push --no-verify",
  ])("%s", (command) => {
    expect(analyzeCommand(command).noVerify).toBe(true);
  });

  it("does not treat -n inside a quoted message as a flag", () => {
    expect(analyzeCommand('git commit -m "use -n carefully"').noVerify).toBe(false);
  });
});

describe("normalizeCwd", () => {
  it("uppercases a lowercase Windows drive letter", () => {
    expect(normalizeCwd("c:\\Users\\me\\repo")).toBe("C:\\Users\\me\\repo");
  });

  it("leaves other paths unchanged", () => {
    expect(normalizeCwd("C:\\Users\\me\\repo")).toBe("C:\\Users\\me\\repo");
    expect(normalizeCwd("/home/me/repo")).toBe("/home/me/repo");
  });
});

describe("hook process", () => {
  const run = (input: unknown) =>
    spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });

  it("allows unrelated commands with exit 0", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "git status" } });
    expect(r.status).toBe(0);
  });

  it("blocks --no-verify with exit 2 without running checks", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--no-verify");
  });

  it("blocks malformed input with exit 2", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
