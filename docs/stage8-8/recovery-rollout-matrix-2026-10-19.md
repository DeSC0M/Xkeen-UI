# Stage 8.8: recovery matrix and rollout evidence — 2026-10-19

**Repository commit used for the original preflight:** `c7eb29d883fe9dfd77be88055c321605429e7b27`
**Notification audit follow-up now on remote:** `6d79eb4928953b3b42d428e18684ffeee3420f83`
**Target channel:** `pre-release`
**Decision:** **STOP / 8.8 remains open.** No destructive profile, engine,
restart, fault-injection, install, remove or update operation was performed on
the supplied router.

## Stand and safety preflight

Evidence: [`router-preflight-2026-10-19.json`](router-preflight-2026-10-19.json).

| Item | Observed value | Result |
|---|---|---|
| Router architecture | `aarch64`, Keenetic Linux `4.9-ndm-5` | recorded |
| `/opt` free space | `4,582,812 KiB` (about 4.4 GiB), 11% used | sufficient for a read-only preflight |
| Python | `3.13.9` at `/opt/bin/python3` | recorded |
| Installed panel | `2.10.0-beta.2+local.23ce4d6d` | **local build** |
| Installed profile | `custom` | not a minimal-profile stand |
| Active engines | Xray and Mihomo installed; `mihomo` process running | **protected** |
| Editor | `light` | recorded |
| Lifecycle state | last operation `tool.advanced-diagnostics`, `committed` | clean |
| Notification API | `/api/notifications` returned `404` | router predates 8.7 |
| Writes/restarts/profile changes | none | required safety invariant |

The requested `mihomo-minimal` protection was honored. In fact, the device is
currently `custom` with Mihomo running, so it is not safe to use for destructive
8.8 acceptance while it carries live traffic.

## 8.7 audit synchronization

The original router preflight predates the 8.7 audit follow-up. The current
`pre-release` includes `07faef56`, `be2ebcf2`, `a8d095d6`, `a17c2135`,
`8e2a6819` and `6d79eb49`: stale post-update records are invalidated, a
baseline failure does not invent new modules, the bell is global and responsive,
manual checks coordinate with background work, and browser coverage spans the
header/screens/update navigation. The router still reports `/api/notifications`
as `404`, so that device cannot provide evidence for these newer commits.

For the future signed-device row, retain this exact preflight as historical
evidence and collect a new report after installing a non-local archive built
from the candidate commit. Do not overwrite the 19 October read-only result.

## Signed prerelease evidence

The official prerelease catalog was fetched and verified locally without
downloading a panel or module archive:

| Field | Value |
|---|---|
| Release | `2.10.0-beta.2` |
| Channel | `prerelease` |
| Catalog URL | official immutable GitHub Release asset |
| Catalog SHA-256 | `be40bbaffa3be6748c4386fbc955e8cdd0144c29118877872eb73fb43d728922` |
| Signature key | `release-2026` |
| Modules | 9 |
| Panel archive size | 12,405,174 bytes |
| Panel archive SHA-256 | `17f65139a2d7404e3a086a1564fb992ac15719a5ca8c5bcce418293430fff269` |
| Catalog freshness | `fresh` |

This proves the trust boundary and release identity, not a successful device
installation.

## Acceptance matrix

| Scope | Failure / scenario | UI or error contract | Journal/state expectation | Rollback/restart policy | Evidence | Device status |
|---|---|---|---|---|---|---|
| Trust | Invalid signature, checksum, API, architecture | catalog/archive validation errors; no mutation | no transaction journal | no restart | catalog client/trust/package tests | not run on router |
| Module install | signed prerelease install | plan then `Apply`; `committed` | journal reaches `committed` | restart and health check | module transaction CLI and real-tree tests | **blocked: local router build** |
| Module repair | installed module repair | repair plan; `committed` | exact ownership diff | rollback on health failure | module transaction CLI tests | **blocked** |
| Module remove | dependency/active-engine guard | `module_required_by` / `module_engine_active` | no file mutation on blocker | no restart on blocker | lifecycle/transaction tests | **blocked; Mihomo protected** |
| Panel update | newer signed panel archive | full-scope plan; stale plan rejected | panel journal + previous copy | health failure rolls back | panel update real-tree tests | **blocked: current build is local** |
| Profile transition | full/minimal/custom physical transition | explicit profile request then plan | registry/profile state is journaled | rollback restores profile and state | profile transaction tests | **blocked; no profile switch allowed** |
| Interrupted runner | process loss at prepared/downloading/verifying/applying/state/restarting/health | recovery state visible | journal remains until recovery | rollback or committed outcome is recovered | `test_module_transactions_cli.py` | not run on router |
| Previous-version rollback | explicit rollback without network | `panel-rollback` plan | previous-version copy retained | rollback itself is journaled | panel rollback tests | no previous copy requested |
| Offline with cache | transport failure after verified cache | stale/error state, retry later | cache remains verified | no mutation | catalog client tests | not run on router |
| Offline without cache | transport failure and no cache | `catalog_unavailable`; installed state retained | no operation journal | no restart | catalog client/lifecycle tests | not run on router |
| Notification center | check without archive download | notification records or stale/error | local notification state bounded | no mutation | 8.7 unit/route/E2E tests | **not installed: router returned 404** |
| Legacy/full and editor variants | profile/editor matrix | capability/blocked state is explicit | state survives reload/restart | no destructive shortcut | installer/profile/registry tests | no device matrix |
| `min_updater` | incompatible older updater | `requires_installer` | no panel mutation | use installer path | lifecycle foreign-release tests | not run on router |
| Recovery environment | service/template/command restoration | `environment_restored` status | panel tree and external environment agree | retry remains possible | recovery-environment tests | local test limitation noted below |

## Automated evidence executed

- `227 passed, 7 skipped` in the combined recovery/catalog suite.
- Two command-bound recovery-environment tests are explicitly skipped on a
  Windows host without POSIX `sh`; the same assertions run on Linux/Entware.
  This is not presented as router evidence.
- Stage 8.8 read-only router smoke collector: `4 passed`.
- Live signed prerelease catalog verification: passed.

The Windows helper failures must be reproduced on Linux/Entware before the
environment-restoration rows can be marked fully green.

## Stop/go decision

**STOP** for destructive device acceptance. The supplied router is a live
custom installation with Mihomo running and a local panel build that predates
the Notification center API. The next safe action is a separate spare-router
or isolated storage stand:

1. install the signed prerelease archive;
2. verify a non-local release `BUILD.json`;
3. preserve a user-config checksum and recovery copy;
4. use one selected profile at a time, explicitly excluding the live router;
5. run the destructive rows and capture status/journal/restart evidence;
6. only then decide stable rollout.

No stable release or rollout claim is made by this report.
