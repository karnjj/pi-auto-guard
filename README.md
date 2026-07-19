# Pi Auto Guard

A clean-room Pi extension inspired by Claude Code's Auto permission mode. It lets obviously safe tool calls run, asks before consequential calls, and denies clearly dangerous calls.

The classifier has three layers:

1. Deterministic policy for known-safe reads/edits and mandatory ask/deny cases.
2. A high-recall model screen for unknown tools and ambiguous shell commands.
3. A reasoned model review that returns `allow`, `ask`, or `deny`.

Only recent user messages, normalized tool-call summaries, coarse success/error outcomes, the pending action, and the working directory are sent to the classifier. Assistant prose and tool-result bodies are intentionally excluded. Secret-like fields and values are redacted, and nested input is depth/size bounded.

## Install

From npm:

```bash
pi install npm:pi-auto-guard
```

Or directly from GitHub:

```bash
pi install git:github.com/karnjj/pi-auto-guard
```

For local development:

```bash
git clone https://github.com/karnjj/pi-auto-guard.git
cd pi-auto-guard
npm ci
pi -e .
```

Pi Auto Guard uses the active Pi model and its existing credentials. To use a different model already configured in Pi:

```bash
PI_AUTO_GUARD_MODEL=provider/model-id pi -e .
```

Run `/auto-guard` with no argument to show the current status. Select a mode or reset the guard with:

Auto Guard starts in `standard` mode. Switch modes with:

```text
/auto-guard standard
/auto-guard relaxed
/auto-guard yolo
/auto-guard reset
```

| Classifier verdict | `standard` | `relaxed` | `yolo` |
|---|---|---|---|
| `allow` | Allow | Allow | Allow |
| `ask` | Ask | Allow | Allow |
| `deny` | Deny | Ask | Allow |

`standard` is the default. `relaxed` shifts ordinary verdicts down one safety level, while classifier failures still require confirmation or block headless use. **YOLO mode disables protection entirely:** it skips classification and allows every tool call without confirmation.

`/auto-guard reset` selects `standard` and clears all denial counters.

## Default behavior

- Allows known read-only tools and workspace-local edits.
- Asks for secret reads, writes outside the workspace, destructive Git commands, privilege escalation, package mutations, remote side effects, and similar consequential actions.
- Denies credential exfiltration, disk formatting/overwriting, fork bombs, catastrophic root/home/workspace deletion, and writes to protected repository or security metadata.
- If model classification fails, asks in interactive mode and blocks in headless mode.
- Stops after 3 consecutive or 20 total denied calls until `/auto-guard reset`.
- Relaxed mode automatically runs consequential actions and asks before actions that standard mode would deny.
- YOLO mode bypasses policy and model classification entirely.

## Security

This is a safety guard, not a security sandbox. Pi extensions run in the same process, and other extensions or direct shell access can bypass it. Model classification can also make mistakes. Use an OS sandbox for hostile code and keep `standard` mode enabled for normal use.

The classifier sends a bounded, redacted projection of recent user messages and tool calls to the selected model provider. Review [SECURITY.md](SECURITY.md) for the threat model and vulnerability-reporting process.

## Development

```bash
npm ci
npm run check
```

The policy seam is `evaluatePolicy()`, the classifier seam is `Classifier.classify()`, and Pi-specific model/auth/UI wiring lives only in `extensions/auto-guard.ts`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

MIT
