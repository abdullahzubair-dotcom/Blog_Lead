@AGENTS.md

# Deployment / git remotes (READ THIS)

The **only** live deployment is the `vyro` remote: **github.com/Vyro-ai/seo_email**, branch `main`.
Ship every change there. `vyro/main` auto-deploys on Vercel.

The `origin` remote (github.com/abdullahzubair-dotcom/Blog_Lead) is the **old** repo and is
**no longer used** — do not treat it as production. (You may still push there as a mirror, but
nothing depends on it.)

Note: `vyro/main` is a **protected branch** — direct pushes are rejected. Land changes via a
branch + pull request that a teammate with write access approves and merges.
