# operator-quickstart — app-air-yield

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（deploy だけが要る。§7）。

**出力はすべて 2026-08-18 に実際に walk した結果である。** 走らせていないものは
§7 に「走らせていない」と書く。

## 0. 前提と、この family の環境の罠

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.208 |
| clojure | `clojure --version` | 1.12.5.1654（ビルド時のみ） |
| wrangler | `npx --yes wrangler --version` | 4.69.0（§5 のみ） |

1. **remote は `origin` ではない。** west は remote を org 名で持つので
   `cloud-itonami` である。`git fetch origin` は失敗するが、repo が無いという
   意味ではない。
2. **`error: could not read IPC response` は fsmonitor daemon** であって
   あなたのコマンドではない。`-c core.fsmonitor=false` で黙る。
3. **npm 11.16 は `kotoba/` の git 依存を install できない**（§6）。
4. **高負荷ビルドは workspace 全体で同時 1 本**に制限されている（§4）。

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-air-yield.git
cd app-air-yield
npx --yes nbb scripts/verify-docs-claims.cljs .
```

実際の出力:

```
SCANNED	25
PASS	tracked-files	expected=25	actual=25
PASS	inherited-bytes	expected=4325	actual=4325
PASS	preserved-files-unchanged	expected=[]	actual=[]
PASS	removed-by-migration-absent	expected=[]	actual=[]
PASS	svelte-artifacts	expected=0	actual=0
PASS	appview-ts-files	expected=0	actual=0
PASS	appview-canonical-files	expected=4	actual=4
PASS	kotoba-library-files	expected=7	actual=7
PASS	kotoba-library-bytes	expected=42307	actual=42307
PASS	kotoba-library-unchanged	expected=[]	actual=[]
PASS	wrangler-main	expected="dist/worker.js"	actual="dist/worker.js"
PASS	declared-vars	expected=8	actual=8
PASS	declared-routes	expected=2	actual=2
PASS	no-stale-assets-binding	expected=true	actual=true
PASS	sveltekit-compat-flags	expected=0	actual=0
PASS	shadow-builds-that-main	expected=true	actual=true
PASS	warnings-as-errors-in-compiler-options	expected=true	actual=true
PASS	warnings-as-errors-not-misplaced	expected=true	actual=true
PASS	page-renders-route-table	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。`<dir>` は**引数の先頭**に置く
（多くの gate が最初の非 `--` 引数を tree として読むので、`--flag . ` の順に
すると `"--flag"` の値がパスになる）。

**この検査が落ちることを 4 通りで確かめてある**（§8）。

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'airyield.route-test)
(run-tests 'airyield.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing airyield.route-test

Ran 5 tests containing 29 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` は
移行前の rest parameter `[...path]` と同じく転送する —— 1 セグメントに絞るのは
移行ではなく方針変更）、MCP router の URL 解決（空白だけの設定は未設定として
扱う）、`result` / `structuredContent` の剥がし方、そして**ページが route 表
から描かれること**（固定値を焼いていたら落ちる）。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[airyield.view :as view] '[airyield.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ay-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:APP_NANOID :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "ok"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ay-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/ay-page.html
aggregate: 100.00
axes scored: 10 (viewport, safe-area, dynamic-viewport, tap-targets, focus-visible,
                 reduced-motion, overflow-guard, color-scheme, responsive, semantics)
NOT scored: input-zoom, contrast — pass --extra-axes to include the optional ones
A pass says nothing about an axis that was not applied.
gate: aggregate 100.00 >= min 95.00 -> PASS
```

`--extra-axes` を付けると 12 軸すべてが当たり、**やはり 100.00** である。

**⚠ このスコアは思ったより少ししか保証しない。** CLI 自身が最後の 2 行で
そう言っている。さらに実測（§8）: **デザインシステムの CSS を 1 バイトも
入れずに描画した同じページが 96.63 で、この gate を PASS する。**
「DADS が実際に入っている」と言えるのは §5 の smoke の 2 本目だけである。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js
```

**`exit 2` は失敗ではなく順番待ちである**（`resource-guard: build is already
running (pid=…)`）。迂回せず、retry loop で回す。この walk では 5 回目で lock を
取れた。

実際の出力（末尾）:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 7.38s)
```

`dist/worker.js` は 246,289 バイト、sha256
`c1027f7e2a9ba89114c338d16e55e6506682ec13328b0cd4dd6c85dd49d7b65e`。

**このビルドは再現する。** §8 の mutation を 6 通り当てて全部戻したあと、
同じソースから再ビルドして **同じ sha256** が出ることを確認した。これは
「戻し忘れが無い」ことの検査でもある —— この machine では並行して 4〜5 体の
agent が同じ build lock と `/tmp` を奪い合っているので、**復元したつもりの
ファイルが自分のものだったか**は、成果物の hash を突き合わせるまで分からない。

### 壊れた var はビルドを **落とす**

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` がある。
入れる前は、存在しない var を参照しても shadow は **WARNING** を出して
**exit 0** し、最初のリクエストで `Cannot read properties of undefined` を投げる
bundle を書いていた ——「ビルドが通った」は検査ではなかった（**落ちようが
なかった**）。§8 に、実際に落として確かめた記録がある。

**このキーは `:compiler-options` の下でなければならない。** `:build-options` に
置くと shadow は黙って無視する。検証器はこれを **EDN として読んで**検査する ——
`grep` で書くと、この repo のコメント自身が `:build-options` という文字列を
含んでいるので当たってしまう（§8 に実測）。

## 5. ビルドした bundle を実際に叩く

```bash
npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /health	expected=true	actual=true
PASS	page advertises /xrpc/:nsid	expected=true	actual=true
PASS	page shows a var key	expected=true	actual=true
PASS	page hides other var values	expected=false	actual=false
PASS	page shows the relay target it uses	expected=true	actual=true
PASS	page uses the design system components	expected=true	actual=true
PASS	page carries the stylesheet itself	expected=true	actual=true
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	OPTIONS preflight	expected=204	actual=204
PASS	unknown path	expected=404	actual=404
PASS	wrong method	expected=405	actual=405
OK	the built bundle answers as the route table says
```

**exit 2 = bundle が無い**（判定できなかった）。0 とも 1 とも別の答えである。

### workerd の実機でも叩いた（`compatibility_flags` 撤去の根拠）

`compatibility_flags`（`nodejs_compat` / `nodejs_als`）は SvelteKit の
adapter-cloudflare が要求していたもので、cljs の `:esm` bundle には要らない。
**憶測で消さず、flags 無しの設定のまま workerd で実測してから撤去した**:

```bash
npx --yes wrangler dev --local --port 8847
```

| method | path | status | body（先頭） |
|---|---|---|---|
| GET | `/` | **200** | `<!DOCTYPE html><html lang="ja">…`（82,573 バイト） |
| GET | `/health` | **200** | `{"ok":true,"app":"air-yield","runtime":"cljs","routes":[…]}` |
| POST | `/xrpc/` | **400** | `{"error":"Missing XRPC method"}` |
| POST | `/xrpc/com.etzhayyim.apps.airYield.publishFareClass` | **502** | `{"error":"MCP router unreachable",…}` |
| POST | `/xrpc/a/b` | **502** | `{"error":"MCP router unreachable",…}` |
| OPTIONS | `/xrpc/x` | **204** | （空） |
| GET | `/nope` | **404** | `{"error":"Not Found","routes":[…]}` |
| POST | `/health` | **405** | `{"error":"Method Not Allowed"}` |

多段パス（`/xrpc/a/b`）が単一セグメントと**同じ**扱いになっていることに注意 ——
どちらも 400 ではなく、上流へ行って 502 になる。移行前の `[...path]` と同じ挙動
である。

配信された HTML 上で `--color-primitive-blue` が 45 回、`class="dads-table"` が
1 回。**Node での import ではなく実際の Workers ランタイムでの確認**である。

## 6. `kotoba/` の 9 tests は走らせていない（移行前からの既知）

```bash
cd kotoba && npm install
#   npm error code EALLOWSCRIPTS
#   npm error --allow-scripts is not allowed in project-scoped installs.
```

両依存（`@etzhayyim/sdk` / `@etzhayyim/sdk-mock`）が git URL で、その準備が
入れ子 install を起こし npm 11.16 が拒否する。`allowScripts` を足しても効かない
（拒否は入れ子側で起きる）。**この suite が通るとはどこにも書いていない。**
移行はこれを変えていない。

`kotoba/` は **appview ではなく、移行対象でもない**（README の表を参照）。
どの bundle にも入らず、撤去した何物からも参照されない。検証器がファイル数・
バイト数・sha256 を固定しているので、**黙って育つことはできない**。

## 7. やっていないこと

- **deploy していない。** `wrangler deploy` は実行していない（`wrangler dev
  --local` のみ）。そもそも `air-yield.etzhayyim.com` /
  `a1ry13ld.etzhayyim.com` はどちらも DNS を返さない。
- **`kotoba/` の 9 tests**（§6）。
- **`MIGRATION-TODO.md` の憲章適合レビュー 7 項目**。文書自身が未実施と書いて
  おり、移行はそれを変えない。
- **`APP_CAPABILITIES` の truncation**（8 メソッド中の先頭 3 つだけを宣言）は
  移行前から記録されている所見で、ここでは**変えていない**。

## 8. gate を実際に落として確かめた記録

**緑を受け取る前に、それぞれの gate を赤くしてある。** 落ちない検査は劇場で
あり、一度も緑にならない gate も同じだけ無内容である。

| # | 壊したもの | 赤くなったもの |
|---|---|---|
| 1 | `route.cljc` の `xrpc-nsid` が多段パスを 400 にする | `dispatch-xrpc`（unit test 1 件） |
| 2 | `:warnings-as-errors` を `:build-options` へ移す | `warnings-as-errors-in-compiler-options` + `…-not-misplaced` |
| 3 | 撤去した `svelte/vite.config.ts` が戻る | `removed-by-migration-absent` / `svelte-artifacts` / `appview-ts-files` / `tracked-files` |
| 4 | **別名**の `src/newthing.ts` が入る | `appview-ts-files` / `tracked-files`（撤去リストには載らない経路） |
| 5 | `kotoba/` にファイルが 1 つ増える | `kotoba-library-files` / `kotoba-library-bytes` |
| 6 | `worker.cljs` の `route/dispatch` を存在しない var に改名 | **ビルドが落ちる** — `rc=1`、`ExceptionInfo: Use of undeclared Var airyield.route/dispatch-nonexistent`（`:shadow.build.compiler/warning-as-error true`） |
| 7 | 同上 ＋ `:warnings-as-errors` を `:build-options` に置く | **ビルドが通ってしまう** — `rc=0`、`Build completed. (55 files, 2 compiled, 1 warnings, 10.35s)` |
| 8 | `worker.cljs` の `(rc/inline "jp_go_dds/dds.css")` を `""` に | `page carries the stylesheet itself` **のみ**（component 側は緑のまま） |
| 9 | ページが env の値を出す | `page hides other var values` |
| 10 | ページが中継先を出さなくなる | `page shows the relay target it uses` |

**#6 と #7 は同じ壊れたコードである。** 違うのはキーの位置だけで、結果は
`rc=1` と `rc=0` に分かれる。#7 が出した「成功した」bundle を実際に叩くと:

```
PASS	default export has fetch	expected=true	actual=true
UNDETERMINED	could not exercise the bundle: Cannot read properties of undefined (reading 'h')
exit code = 2
```

最初のリクエストで落ちる bundle を、緑のビルドが出荷していた。**`:build-options`
に置いたこのキーは、落ちようのない検査そのものである。** なお smoke はこれを
「合格」にせず **exit 2（判定できなかった）** を返す。

**grep では #2 を検出できない**（実測）:

| | `grep -c ':warnings-as-errors'` | `grep -c ':build-options'` |
|---|---|---|
| 正しい配置 | 3 | **2** |
| 誤った配置 | 3 | **3** |

どちらも非ゼロなので、grep で書いた検査は両者を区別できない —— 正しい配置の
ファイル自身のコメントが `:build-options` を含むからである。だから検証器は
**EDN として読む**。

**デザインシステムの検査を 2 本に割った理由**（#8）。実測（このページ）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table` | 74 | **6**（0 にならない） |
| `--color-primitive-blue` | 45 | **0** |

`dads-table` が在ることは view が出力する markup の話で、CSS が 1 バイトも
入っていないページにも現れる。**component を使ったか**と**stylesheet が実際に
入ったか**は別の主張なので、別の検査にする。

**値の露出も 2 本**（#9 / #10）。出てはいけない値（別 var に置いた sentinel）と、
出なければならない値（中継先 URL）。片方だけだと「全部隠す」実装も「全部出す」
実装も通ってしまう。中継先は `.invalid`（RFC 2606 で必ず解決しない TLD）に
してあるので、この検査は実 DNS に依存しない。

**mutation は 1 つずつ当てた。** 2 つ同時に当てると互いを隠す（値漏洩と中継先の
mutation を同時に当てると、漏れた値の中に中継先 URL が含まれてしまい「中継先を
出している」が緑のままになる）。
