<p align="right">
  <a href="SECURITY.md">简体中文</a> · <strong>English</strong>
</p>

# Security Policy

Do not disclose unpatched security vulnerabilities, credentials, tokens, or
directly exploitable details in public issues, pull requests, discussions, or
chat.

## Reporting a vulnerability

The preferred channel is GitHub's private vulnerability reporting form:

<https://github.com/makecindy/cindy-official-plugins/security/advisories/new>

If that form is unavailable, email **feedback@cindy.app**. We recommend using
`[Cindy Security]` in the subject. If reproduction materials contain sensitive
information, tell us in the email and wait for the maintainers to provide an
appropriate secure transfer method. Do not send sensitive materials through a
public channel.

## What to include

Please provide as much of the following as possible:

- the affected plugin name and its `ghost.json` version (or commit);
- affected platform, component, and configuration;
- reproduction steps, a minimal PoC, or logs, after removing credentials and
  personal data;
- potential impact, exploitation requirements, and any suggested mitigation.

If the issue involves the Cindy client or the Plugin Server itself (rather than
a plugin's code), please also report it through the private channels above and
we will route it to the appropriate maintainers. Do not disclose details in a
public issue.

## Response process

We will acknowledge the report, reproduce it, assess its impact, and update the
report when a fix or mitigation can be disclosed. Our target cadence:
**acknowledgement with an initial assessment within 5 business days**, and a
**90-day coordinated disclosure window** for confirmed vulnerabilities
(adjustable in coordination with the reporter). If you hear nothing for more
than 7 days, please ping us through the other channel (email or GitHub).

## Contributor notes

- Do not put real user data, access tokens, private keys, or internal endpoints
  in issues, test fixtures, or commits.
- If you accidentally commit sensitive information, report it privately
  immediately. Deleting the file from the working tree does not invalidate
  secrets that may exist in Git history.
- Use public issues for ordinary bugs, documentation problems, and feature
  requests. Do not use the security channel for those topics.
