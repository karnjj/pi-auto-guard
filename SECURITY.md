# Security policy

## Reporting a vulnerability

Please report security vulnerabilities through [GitHub private vulnerability reporting](https://github.com/karnjj/pi-auto-guard/security/advisories/new). Do not open a public issue containing exploit details, credentials, or sensitive transcripts.

Include the affected version, Pi version, tool call, expected verdict, actual verdict, and the smallest safe reproduction you can provide. Redact credentials and private source code.

## Threat model

Pi Auto Guard is a policy and confirmation layer. It is not an operating-system sandbox or a security boundary.

- Extensions execute in the Pi process and can bypass this extension.
- Direct shell access outside Pi is not intercepted.
- Model classifiers can misclassify actions.
- Secret redaction reduces accidental disclosure but cannot guarantee that arbitrary sensitive content is detected.
- Relaxed mode intentionally changes `ask` to `allow` and `deny` to `ask`. Classifier failures remain confirmation-required in interactive sessions and blocked in headless sessions.
- YOLO mode bypasses Auto Guard entirely. It performs no policy or model classification and never asks for confirmation.

Use process, container, filesystem, and network isolation when running untrusted code.
