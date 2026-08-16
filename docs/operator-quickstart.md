# Operator quickstart — app-air-yield

22 tracked files: fare classes, inventory and revenue management for an airline. Two
things to know before reading them.

**The file that looks like the entry point is not the one that gets deployed.**
`wrangler.jsonc`'s `main` is the SvelteKit build; `src/app.ts` (76 lines, header
`// 8 methods: publishFareClass / adjustInventory / …`, serving `/health` and
`/_app/meta`) is not deployed, and `not_found_handling: "none"` makes a GET `/health`
a 404. A monitor pointed there is watching a path that does not exist.

**Everything structural here is true of all nine `app-air-*` repositories,
identically** — measured in one pass; the command and the nine-row table are in
`cloud-itonami/app-air-mro/docs/operator-quickstart.md` §1. The sharpest form:
`APP_CAPABILITIES` holds the **first three of eight** header methods, in order, in
9 of 9 repositories. It is a truncation, not a curated subset. Here the five it omits
are `setOverbooking`, `processGroupBooking`, `applyDynamicPrice`,
`generateRevenueReport`, `forecastDemand`.

Steps marked ✅ were run on 2026-08-16. §4 says what was not walked.

---

## 1. ✅ What this repository actually contains

```bash
wc -l src/app.ts kotoba/src/registry.ts kotoba/test/air-yield.test.ts
#    76 src/app.ts                    (not deployed — see above)
#   393 kotoba/src/registry.ts        (the domain logic)
#   137 kotoba/test/air-yield.test.ts
grep -cE '\b(it|test)\(' kotoba/test/air-yield.test.ts   # 9
```

The nine siblings share the scaffolding and differ exactly here: `app-air-mro` has a
434-line registry with 12 tests, this one 393 with 9, `app-air-sched` 287 with 5.
**Family-wide findings transfer between siblings; the contents of `kotoba/` do not.**

Two deployed routes:

```bash
find svelte/src/routes -type f | sed 's|svelte/src/routes||'
#   /+page.svelte
#   /xrpc/[...path]/+server.ts
```

The xrpc route forwards whatever NSID is in the path to `AGENTGATEWAY_MCP_ROUTER_URL`
(default `https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message`) as a JSON-RPC
`tools/call`. `grep -c 'airYield'` on it returns **0** — it serves every operation and
none, because the method list lives upstream in the MCP router. This repository is not
where you learn what the app can do, and `APP_CAPABILITIES` is documentation rather
than enforcement.

## 2. ✅ The landing page told visitors it had no routes and no vars — fixed, and the render was checked

`svelte/src/routes/+page.svelte` embeds a summary object and renders it. Before this
commit it said `routeCount: 0, routes: [], vars: []`, with a `relativePath` pointing
into the monorepo this repository was extracted from.

**Rendered over HTTP, before and after.** `vite preview` serves the built worker, so
the page can be fetched rather than reasoned about:

```bash
cd svelte && npm install --no-audit --no-fund && npm run build
npx vite preview --port 4398 &
curl -s http://localhost:4398/ > page.html
grep -c 'No public route is declared\|No public vars are declared' page.html
grep -c 'air-yield\.etzhayyim\.com/\*' page.html
grep -oE 'Routes</span>.{0,40}' page.html
```

| in the rendered HTML | before | after |
|---|---|---|
| false sentences present | 1 | **0** |
| names its own address | no | **yes** |
| lists var names | no | **yes** |
| the `Routes` figure | `<strong …>0</strong>` | `<strong …>2</strong>` |

The two sentences it used to print were:

> No public route is declared next to this app surface.
> No public vars are declared in the nearest wrangler config.

Both name the wrangler config and both were false — `wrangler.jsonc` declares two
route patterns, one of which is the address the page is served at, and eight vars.

**Why the render mattered.** The same fix in the sibling `app-air-sched` was verified
only by grepping the build output, and that cannot settle it: Svelte compiles **both**
branches of an `{#if}` into the component, so the false sentences remain in the bundle
even when they cannot render. Grepping the bundle there showed the data entering the
build and nothing about which branch wins. Fetching the page settles it.

The summary is now populated from `wrangler.jsonc`: `routeCount: 2`, both patterns,
the eight var **names** (the page prints keys only, never values), and a
`relativePath` inside this repository.

There is no generator for this object in this repository or in the root's `scripts/`,
so it is hand-maintained: **change routes or vars in `wrangler.jsonc` and this object
will not follow.** Seven of the nine siblings still carry the stale version; this round
changed one repository.

## 3. ⚠ The repository declares itself an unremediated seed, with its own caveat

`MIGRATION-TODO.md` says `Status: 🔄 TRANSFORM — seed copied 2026-05-21, codemod
pending`, with seven boxes and none ticked, listing invariants "likely violated and
MUST be remediated": `@etzhayyim/sdk` replacing direct `@atproto/api` / `viem` /
IPFS-client imports, stripping centralized DB code, stripping fiat processors, and a
§2(a) military-use exclusion codemod.

Its own last paragraph qualifies them, and the qualification belongs with them:

> The TRANSFORM classification was based on the app's domain pattern (commerce /
> communication adapter / media etc.), not on detected violations. Manual review is
> still required to confirm Charter §2(a)-(h) and substrate-boundary compliance.

They are a review checklist derived from the app's category, not seven confirmed
defects. What is certain is that the review has not happened, while `wrangler.jsonc`
declares live routes on `etzhayyim.com`.

## 4. ⚠ NOT WALKED: the kotoba test suite

Nine tests against the 393-line registry — the most valuable unrun check here:

```bash
cd kotoba && npm install
#   npm error code EALLOWSCRIPTS
#   npm error --allow-scripts is not allowed in project-scoped installs.
```

Both dependencies are git URLs (`@etzhayyim/sdk`, `@etzhayyim/sdk-mock`) whose
preparation runs a nested install that npm 11.16 refuses; an `allowScripts` field does
not help, because the rejection happens inside the nested install.
`cloud-itonami/app-air-crew/docs/operator-quickstart.md` §5 documents a workaround and
§8 records what it costs. Nothing here claims the suite passes.

`svelte/` installs, builds and previews cleanly (§2) — no git dependencies.

## 5. The family's environment traps

Documented at length in `app-air-crew`'s §0. Short list:

1. **the remote is not `origin`** — west names remotes after the org, so it is
   `cloud-itonami`; `git fetch origin` fails on access rights.
2. **`error: could not read IPC response` is the fsmonitor daemon**, not your command.
   `-c core.fsmonitor=false` silences it.
3. **npm 11.16 cannot install the `kotoba/` git dependencies** (§4).
4. **`esbuild --loader=ts` is rejected** for a file input; drop the flag.
5. **there is no `.gitignore`** — building in the checkout leaves `node_modules/`,
   `.svelte-kit/` and any `page.html` untracked. Build in a worktree, or clean up.

## 6. What the maturity instrument sees here ✅

```
· orgs/cloud-itonami/app-air-yield  own=0.049  axis-docs=0bp → +2500bp
    ⚠ README が .md ではないので docs の README 成分は 0（README.edn 等が 1 件）
    ⚠ taxonomy に :repo/kind の行が無い → :default の重みで採点されている
```

Both are about the instrument. `README.edn` declares `:canonical-metadata :edn`, so EDN
is deliberately canonical here while the score reads `README.md`; and this repository
has no row in `manifest/repo-taxonomy.edn`, so it is scored against a guessed weight
profile and its `own` is not comparable to a repository whose kind is known. Recorded
in ADR-2608052000 — not gaps to close by adding a second README.
