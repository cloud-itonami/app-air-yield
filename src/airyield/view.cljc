(ns airyield.view
  "この appview の説明ページ。純 hiccup、I/O 無し。

  基盤は `jp-go-dds`（デジタル庁デザインシステム）—— superproject の skill
  `kotoba-uiux` が定める新規 UI の base。色と寸法は `--hig-*` トークン契約
  だけで書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。** これは様式の
  好みではなく、この移行が消しにきた欠陥そのものへの答えである —— 移行前の
  `+page.svelte` は route 数も var 一覧も literal で抱えており、隣の
  `wrangler.jsonc` が何を宣言しているか知らなかった。ここでは route 表と
  設定を渡す側が持ち、ページは描くだけなので、両者がずれる余地が無い。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [clojure.string :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う（bridge が DADS の上に再定義
  する）。DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge
  が運んでいないトークンは何にも解決しない —— 使うのは運ばれている中だけ。"
  (str/join
   "\n"
   [".ay-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".ay-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ay-mono { font-family: var(--hig-font-mono); overflow-wrap: anywhere; }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper-case (name (:route/method r)))
           [:span {:class "ay-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    airyield.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キー名だけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値。値そのものを出す）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Air Revenue Management — air-yield")
    [:p {:class "ay-lede"}
     "航空座席の収益管理（revenue management）を担う appview の公開面。"
     "運賃クラスの公開・在庫調整・運賃申請・オーバーブッキング・団体予約・"
     "動的価格・収益レポート・需要予測を扱うが、**その判断そのものはここには無い** —— "
     "この面は XRPC を上流の MCP router へ中継するだけの edge である。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ay-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div
       (into [:p] (interpose " " (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ay-note"}
        "env の**キー名のみ**。値は出さない —— **ただし下の中継先だけは値その"
        "ものを出す**（"
        [:span {:class "ay-mono"} "AGENTGATEWAY_MCP_ROUTER_URL"]
        "）。どこへ中継するかは運用者が見る必要があるので意図的に表示している。"]]
      [:p {:class "ay-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ay-note"} "XRPC の中継先: "
     [:span {:class "ay-mono"} mcp-url]])

   (dds/section
    {:title "現在地"}
    [:p {:class "ay-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。移行前は "
     [:span {:class "ay-mono"} "wrangler.jsonc"]
     " の main が SvelteKit のビルド出力を指しており、読み手が開く TypeScript は"
     "どの bundle にも入っていなかった。"]
    [:p {:class "ay-note"}
     "この repo の "
     [:span {:class "ay-mono"} "kotoba/"]
     " にある TypeScript の領域ライブラリは、この bundle の一部ではなく、"
     "移行の対象でもない（README を参照）。"]
    (when built-at
      [:p {:class "ay-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す（ライブラリは I/O を持たない）。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Air Revenue Management — air-yield"
    :description "航空座席の収益管理を担う appview の公開面。XRPC を MCP router へ中継する。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
