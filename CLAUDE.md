# Agent Auditor: rules for every Claude Code session

This repo is **public**. Four people (Cooper, Nizar, Fabi, Aidan) each work with their own Claude
against the same names, so these rules are not optional.

## Before you write any code

1. **Read `SPEC.md` completely.** It is the source of truth for table names, columns, endpoints,
   request/response fields, status values, reason strings and function signatures. Also read
   `#hackathongroupaudit` since your person's last handoff and tell them what changed for their part.
2. **Use the exact names from SPEC.md.** Never rename or invent a table, column, endpoint, field,
   status, reason string or shared function signature. If SPEC.md is unclear, wrong or missing
   something, stop and propose the change in `#hackathongroupaudit`. Don't guess in code.
3. **Stay inside your person's ownership (SPEC.md section 11).** To change someone else's part
   (a table, an endpoint, `lib/rules.ts`, `config/rules.json`, `lib/booking.ts`, a seller, the
   dashboard), propose it in Slack. If you need their function before it exists, call the exact
   signature from SPEC.md behind a clearly labelled stub; never write a replacement implementation.

## Git workflow

4. **One branch per task**, named `yourname/what-it-does` (e.g. `fabi/dataco-seller`).
   Start every session with `git checkout main && git pull`, then branch from `main` (or merge `main`
   into your existing branch).
5. **Never commit to `main`.** The single bootstrap commit was the only exception. `main` changes
   only through a merged PR that someone else reviewed. Nobody merges their own PR.
6. **`npm run check` must pass before every commit** (typecheck, lint, tests, build). The hook in
   `.claude/settings.json` enforces this. Don't remove, edit or work around it.
7. **Actually run what you changed**: call the endpoint, load the page, run the script. Show your
   person the real output. Passing tests alone is not "done".
8. **Read every line of `git diff --staged` before committing**: no stray `console.log`, commented-out
   code, or unrelated files.
9. **Stage files by name**: `git add path/to/file`. Never `git add -A`, `git add .` or `git commit -a`.
10. **Never commit secrets.** Keys live only in `.env.local` (gitignored). That means wallet keys, the
    Supabase service-role key, the QuickNode secret, `ANTHROPIC_API_KEY`. Never print private keys.
    If a secret is ever committed, tell the team immediately: it must be rotated, because deleting
    it later does not remove it from git history.
11. **Fix the code, not the test.** If an expected value truly must change, explain why in the PR.
    Cooper's 11 rule test cases never change unless Cooper agrees in Slack.
12. **No new dependency without a reason written in the PR description.**
13. **Never force-push a shared branch**, and never use `--no-verify` (the hook blocks it).

## End of every session

14. Post a handoff in `#hackathongroupaudit`, **five lines max**:
    1. Built: what was built and verified
    2. PR: the link
    3. Shared changes: any change to tables, endpoints, fields or interfaces (or "none")
    4. Needs: what you need, from whom
    5. Next: blockers and the next step

## Project facts

- Next.js App Router + TypeScript (strict), npm, Vitest, ESLint, Supabase.
- Solana **devnet only**. USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- All money is an **integer in USDC base units** (1 USDC = 1000000). Never floats.
- The buyer agent never pays directly; only the gateway holds the wallet key.
- Copy `.env.example` to `.env.local` and fill in values locally. Never commit `.env.local`.
