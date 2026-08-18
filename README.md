# app-air-yield

**航空座席の収益管理（airline revenue management）を担う appview の公開面。**
運賃クラスの公開・在庫調整・運賃申請・オーバーブッキング・団体予約・動的価格・
収益レポート・需要予測を扱う面だが、**その判断そのものはここには無い** ——
この repo が持つのは XRPC を上流の MCP router へ中継する edge Worker と、
その説明ページである。

`etzhayyim/root` の `60-apps/etzhayyim-project-air-yield` からの抽出物で、
**2026-08-18 に appview を TypeScript/Svelte から ClojureScript へ移行した**
（`docs/adr/0001`）。この README の数値はすべて
`scripts/verify-docs-claims.cljs` が tree から再計算して検査する。

## deploy されるものは、いま読んでいるソースである

```
src/airyield/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/airyield/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/airyield/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js             ← wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js`（SvelteKit の
ビルド出力。**tree には存在しない**）を指し、読み手が開く `src/app.ts` は
**どの bundle にも入っていなかった**。いまは `main` が指す bundle が上の
ソースからコンパイルされたものなので、その形は構造的に起こり得ない。
`scripts/verify-docs-claims.cljs` が **shadow の出力先と wrangler の `main` と
export の ns 名の 3 つが噛み合っていること**を検査し、噛み合わなくなれば落ちる。

判断を `.cljc` に置いてあるのは、ブラウザもビルドも無しにテストするためであり、
ingress capability が qualify した時に **最初に `.kotoba` へ移る部分**だからで
ある（入口を当面 cljs に置くのは ADR-2606290000 の判断）。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認（**移植ではなく追加**。下記） |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `airyield.route/routes` で、ページもそこから描く。** 移行前の
`+page.svelte` は route 一覧・var 一覧・`routeCount` をソース中の定数として
持っていた。2026-08-16 に手で `routeCount: 0` → `2` へ直された跡が git 履歴に
あるが、**直す人が居なければ 0 のままだった** —— 隣の `wrangler.jsonc` と同期
する仕組みが無かったからである。いまは route 表を渡す側が持ち、ページは描く
だけなので、両者がずれる余地が無い。

`/xrpc/` は **空の nsid だけ** 400 にする。`/xrpc/a/b` のような多段パスは移行前
の SvelteKit rest parameter `[...path]` と同じくそのまま転送する —— 1 セグメント
に絞るのは**移行ではなく方針変更**なので、この commit ではしない。

### `/health` は移植ではなく追加である

移行前に deploy されていた面に `/health` は無い。`assets` の
`not_found_handling: "none"` により GET `/health` は 404 で、
`docs/operator-quickstart.md` が以前『そこを指した監視は存在しないパスを見て
いる』と記録していた。`src/app.ts` は `/health` を持っていたが、その file は
どの bundle にも入っていなかった。移行後の Worker は `/health` を **持つ**。
純ローカルな handler で上流も binding も要らない。

## いま在るもの — 25 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/airyield/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/airyield/route_test.cljc`（5 tests / 29 assertions） |
| gate | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| ビルド | `deps.edn` / `shadow-cljs.edn` / `.gitignore` |
| Worker 設定 | `wrangler.jsonc` |
| actor 記述子 | `kotodama.jsonld` |
| 領域ライブラリ（**移行対象外**） | `kotoba/`（7 ファイル、42,307 バイト） |
| 由来・権利・識別 | `NOTICE` / `README.edn` / `migration.edn` / `MIGRATION-TODO.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/0001-*.edn` |

**appview の TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 4 本。**
移行前は 3 対 0 だった（`.ts` 3 本 + `.svelte` 1 本 + `svelte.config.js`）。
この 2 つの数は検証器の claim なので、TS が戻れば落ちる —— 撤去した 9 パスに
戻る場合（`removed-by-migration-absent`）も、別名で入る場合
（`appview-ts-files`）も、別々の claim が捕まえる。

## `kotoba/` は移行していない（そして消していない）

この repo には **appview ではない TypeScript** が 7 ファイル 42,307 バイトある。
運賃・在庫・収益台帳の領域ライブラリで、`registry.ts` 393 行 + `types.ts` 408 行
+ 9 tests。測った上で **残した**:

| 測ったこと | 結果 |
|---|---|
| どれかの bundle に入っているか | **入っていない**（`main` は `dist/worker.js`） |
| 撤去した何かから参照されているか | **されていない**（外部からの参照 0 件） |
| 依存が宣言されているか | **されている**（自分の `package.json`。`@etzhayyim/sdk` / `@etzhayyim/sdk-mock`、いずれも git URL） |
| 依存が実際に解決するか | **する**。両 repo とも `git ls-remote` が応答し、pin された SHA（`12314a0c` / `c857ff9b`）は `git cat-file -t` が **`commit`** と答える |

「TypeScript を全部消す」を repo 全体に当てれば、これは migration ではなく
destruction である。移行するなら `@etzhayyim/sdk` の cljs face が要る**別の決定**。
**黙って育たないように**、検証器がファイル数・バイト数・各 sha256 を固定する。

なお `kotoba/` の 9 tests は **走らせていない**。両依存が git URL で、その準備が
入れ子 install を起こし npm 11.16 が `EALLOWSCRIPTS` で拒否する（移行前から
`docs/operator-quickstart.md` §4 に記録されていた既知の事実で、移行はこれを
変えない）。**この suite が通るとはどこにも書いていない。**

## 移していないもの（黙って消していない）

`src/app.ts` にあって **どこにも deploy されていなかった** 経路のうち:

- **8 メソッドの `dispatcher.etzhayyim.com` 中継** —— 宛先が NXDOMAIN で、必要な
  binding（`DISPATCHER_URL` / `DISPATCHER_INTERNAL_SECRET`）が `wrangler.jsonc` に
  **1 つも宣言されていない**。
- **`/_app/meta`** —— `/health` と同じ本体を返す重複エンドポイント。

動かない経路を移植して「移行済み」と言わないためである。必要になった時点で
`route.cljc` に足し、テストと binding を伴って戻す。

## ページが出す値・出さない値

env の**キー名**は出すが、値は出さない —— **中継先を除いて**。
`AGENTGATEWAY_MCP_ROUTER_URL` の値だけは、どこへ中継するかを運用者が見る必要が
あるので意図的に表示する。

smoke はこれを**2 つの独立した印**で見る: 別の var に置いた sentinel が出て
**いない**こと、そして中継先の値が出て**いる**こと。片方だけだと「全部隠す」
実装も「全部出す」実装も通ってしまう。中継先は `.invalid`（RFC 2606 で必ず解決
しない TLD）にしてあるので、この検査は実 DNS に依存しない。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも
置かない。app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100**（gate 95）。
既定の 10 軸に加え、`--extra-axes` で **12 軸すべてでも 100.00**。

### デザインシステムの検査は 2 本ある

`dads-table` が在ることを 1 本で見る形は**落ちない検査**だった —— それは view が
出力する markup であって、CSS が 1 バイトも入っていないページにも現れる。
実測（このページ、2026-08-18）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table` | 74 | **6**（0 にならない） |
| `--color-primitive-blue` | 45 | **0** |

だから 2 本に割った。**component を使ったか**（`class="dads-table"`）と
**stylesheet が実際に入ったか**（`--color-primitive-blue`）は別の主張である。

design-quality のスコアはこの区別をしない。CLI 自身が
`axes scored: 10 … A pass says nothing about an axis that was not applied` と
出力する。「DADS が実際に入っている」と言えるのは smoke の 2 本目だけである。

## 呼び先が 1 つも解決しない（移行では直らない）

| ホスト | 役割 | DNS（2026-08-18 実測） |
|---|---|---|
| `air-yield.etzhayyim.com` | 公開ホスト（wrangler の route） | **無回答** |
| `a1ry13ld.etzhayyim.com` | 同（nanoid 側） | **無回答** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **無回答** |
| `dispatcher.etzhayyim.com` | 移していない `src/app.ts` の中継先 | **無回答** |

deploy 先も中継先も、いま存在しない（`etzhayyim.com` 自体は解決する）。
`/xrpc/` は到達できなければ **502 を返す** —— 成功と同じ形で隠さない。

## 由来（custody）

`migration.edn` は出所を `etzhayyim/root` の tree `239c3ee4` と宣言し、
`:allowed-additions` に `README.edn` と `migration.edn` を持つ。移行後の状態:

- 継承した 5 ファイル（4,325 バイト）は**いまも 1 バイトも変わっていない**
  （sha256 を検証器に固定）
- `kotoba/` の 7 ファイルも**変えていない**（同じく sha256 を固定）
- `wrangler.jsonc` は**意図的に変更**した（`main` の付け替え、消えた SvelteKit
  client を指す `assets` の撤去、`APP_FRAMEWORK` の更新、SvelteKit の
  adapter-cloudflare が要求していた `compatibility_flags` と、`.wasm` が 1 つも
  無いのに残っていた `CompiledWasm` rules の撤去）
- TypeScript/Svelte の 9 ファイルは**移行で撤去**した。検証器はその 9 パスを
  名指しで「不在であること」を検査する —— バイト合計は「TS が消えた」と言えない

## 残っている欠陥（移行では直っていない）

1. **ホストが NXDOMAIN**（上表）。deploy するか retire するかは別の決定。
2. **`MIGRATION-TODO.md` のチェックボックス 7 件が未チェック**のまま。憲章適合の
   手動レビューは未実施であると文書自身が書いている。
3. **`kotoba/` の 9 tests が未実行**（上記、npm の `EALLOWSCRIPTS`）。
4. **`APP_CAPABILITIES` は 8 メソッドの先頭 3 つだけ**を宣言している。9 つの
   `app-air-*` 兄弟すべてで同じ形なので curation ではなく truncation である
   （移行前から記録されていた所見。ここでは変えていない）。

## 検証

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .     # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テスト・描画採点・ビルド・smoke は `docs/operator-quickstart.md`。
