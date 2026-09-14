# Phase 9 release QA closure

Phase 9 is the final roadmap phase. The roadmap has ten numbered phases (`Phase 0` through `Phase 9`); there is no separate Phase 10 implementation phase.

## Release gates

- Backend regression and security suite: `node backend/test-security-verify.js`
- Visual QA isolation guards: `node backend/test-harness-isolation-guards.js`
- Frontend production build: `cd frontend && npm run build`
- Syntax checks: `node --check` for changed backend modules
- Repository hygiene: review `git diff --check`, secret scanning, and changed-file boundaries
- Responsive QA: verify 1440, 1280, 768, 390, and 375 pixel viewports with no body overflow

The current implementation includes Phases 0–8 and the Phase 9 documentation/release gates. GitHub publishing is intentionally a separate operator action because it requires the repository owner’s credentials and branch policy.

## Deployment notes

The active application directories are `backend/` and `frontend/`. The root `client/` and `server/` directories are compatibility copies and must remain untouched. Use an isolated database for visual QA and seed operations; production data must never be reset by test tooling.

See [architecture.md](architecture.md) for the route map, privacy contracts, ledger consistency model, and GitHub webhook configuration.
