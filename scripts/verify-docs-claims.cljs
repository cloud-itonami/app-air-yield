#!/usr/bin/env nbb
;; verify-docs-claims — README.md と docs/operator-quickstart.md が述べる数値・
;; 存在・不在を tree から再計算し、prose と tree が食い違ったら落ちる。
;;
;; 移行前、この repo の核心的な事実は GAP だった: deploy される Worker は
;; SvelteKit のビルド出力で、application に読める src/app.ts はどの bundle にも
;; 入っていなかった。その gap は閉じたので、claim は **閉じたこと** を主張する。
;; そして黙って戻らないように書く —— TypeScript は「バイト合計が減った」では
;; なく **名指しで不在** を検査する。
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> は先頭、既定 ".")
;; Exit:   0 全 claim 成立 · 1 claim が偽 · 2 答えられなかった

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[clojure.string :as str]
         '[cljs.reader :as reader])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 25
   :inherited-bytes 4325           ; 継承した 5 ファイルを 1 バイトも変えていない
   :svelte-artifacts 0             ; .svelte / svelte.config / svelte/ が 1 つも残らない
   :sveltekit-compat-flags 0       ; nodejs_compat / nodejs_als は adapter-cloudflare のもの
   :appview-ts-files 0             ; appview の TypeScript は 0（kotoba/ は別勘定、下記）
   :appview-canonical-files 4      ; route.cljc / view.cljc / worker.cljs + route_test.cljc
   :kotoba-library-files 7         ; 移行対象ではない領域ライブラリ。**増えたら落ちる**
   :kotoba-library-bytes 42307
   :declared-vars 8
   :declared-routes 2
   :wrangler-main "dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "airyield.worker/handler"})

;; 継承したまま **1 バイトも変えていない** ファイル。wrangler.jsonc はこの集合から
;; 意図的に外してある（移行で書き換えたので）。内容で検査する（下記）。
(def preserved
  {"MIGRATION-TODO.md" "dc0856a5b6be6c024e6ff2e45801556470b667f1509c0d37cb3d094f6d53418b"
   "NOTICE"            "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn"        "6dbc0d7dc69a76e3eac2e80c4cc638424ab9c173c6f1dcc820c020b373392748"
   "migration.edn"     "75ab712ec8eb112e83ac52ff336fff5f899c7af00e8cfe218842a8fabbc589e8"
   "kotodama.jsonld"   "43151c46b971341870fc88cbad8d4129db6efe06526ee6a5341dab39c25d8d3c"})

;; kotoba/ は **移行対象ではない** TypeScript の領域ライブラリである。どの bundle
;; にも入らず（wrangler の main は dist/worker.js）、撤去した何物からも参照されず、
;; 依存は自分の package.json に宣言されている。だから消さない。
;; ただし **黙って育たない** ように、ファイル数とバイト数と sha を固定する。
;; 移行するなら、それは別の決定である（@etzhayyim/sdk の cljs face が要る）。
(def kotoba-library
  {"kotoba/package.json"          "1334ccf53d0e6a55c6cc0ccf57e2a07f35478e23f7c248ca089747bc4a4dc601"
   "kotoba/src/index.ts"          "e042528cd4b5ee28dca81e1df3cbc785626a28ca8c399aa639b91fac9255cc82"
   "kotoba/src/registry.ts"       "f2e2418420857009ca285a60e17fc1abbbcd999c6263e29ec1b416bd0ac16f8d"
   "kotoba/src/types.ts"          "12bda9b701c55006254f4f5102e73f6ed951d29af30e21a8025ee77a0a8c296f"
   "kotoba/test/air-yield.test.ts" "686f03a621b930ce25d18d8f8c3e8f7ac2fd8a34ec17775f97b0ea88093f65bd"
   "kotoba/tsconfig.json"         "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts"      "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; 移行が **撤去した** もの、名指しで。バイト合計は「TypeScript が消えた」と言えない。
;; これは言えるし、どれか 1 つでも戻れば落ちる。
(def removed-by-migration
  ["src/app.ts"
   "package.json"
   "svelte/package.json"
   "svelte/src/app.html"
   "svelte/src/routes/+page.svelte"
   "svelte/src/routes/xrpc/[...path]/+server.ts"
   "svelte/svelte.config.js"
   "svelte/tsconfig.json"
   "svelte/vite.config.ts"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; TypeScript は名指しで不在
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte は消え、戻ってきてはならない。上の撤去リストは 8 パスを名指しするが、
    ;; ここは **別名で戻ってきても** 捕まえる（新しい .svelte / svelte.config /
    ;; svelte/ ディレクトリ）。
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/starts-with? % "svelte/")
                                (str/includes? % "/svelte/"))
                           files)))

    ;; 言語の勘定。**kotoba/ を除いた** appview の TypeScript は 0 でなければならず、
    ;; kotoba/ は別 claim で固定する（消さないが、育たない）。
    (let [appview (remove #(or (str/starts-with? % "kotoba/")
                               (str/starts-with? % "scripts/"))
                          files)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") appview)))
      (check! :appview-canonical-files (:appview-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) appview))))

    (let [k (filter #(str/starts-with? % "kotoba/") files)]
      (check! :kotoba-library-files (:kotoba-library-files claims) (count k))
      (check! :kotoba-library-bytes (:kotoba-library-bytes claims)
              (reduce + 0 (keep #(get sizes %) k)))
      (check! :kotoba-library-unchanged []
              (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                          (when-not (= want got) (str f " " (or got "MISSING")))))
                         kotoba-library))))

    ;; deploy される bundle が、この tree のソースから作られること
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc)
          sh-text (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh-text))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)
              sh (try (reader/read-string sh-text)
                      (catch :default e (undet! (str "shadow-cljs.edn unparseable: " (.-message e))) nil))]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; 消えた SvelteKit の client ディレクトリを指す assets は撤去した
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (when sh
            (let [b (get-in sh [:builds :worker])]
              (check! :shadow-builds-that-main true
                      (and (= (:output-dir b) (:shadow-output-dir claims))
                           (= (get-in b [:modules :worker :exports 'default])
                              (symbol (:shadow-export claims)))
                           (str/includes? (or (get j "main") "")
                                          (str (:shadow-output-dir claims) "/worker.js"))))
              ;; **EDN として読んで検査する。grep しない。** この repo のコメントは
              ;; ":build-options" という文字列を含んでおり、grep はそれに当たる ——
              ;; つまり grep で書いた検査は自分のコメントで緑になる。落ちようのない
              ;; 検査を防ぐこと自体が、このオプションの目的である。
              (check! :warnings-as-errors-in-compiler-options true
                      (true? (get-in b [:compiler-options :warnings-as-errors])))
              (check! :warnings-as-errors-not-misplaced true
                      (nil? (get-in b [:build-options :warnings-as-errors]))))))))

    ;; ページは route 表を描く（固定値ではない）。**部分文字列の禁止では書かない** ——
    ;; 初版は "routeCount" をどこにも許さない形で書けてしまうが、それは旧欠陥を
    ;; 説明する docstring に当たる。コメントで落ちる検査は prose についての検査である。
    (let [v (slurp* "src/airyield/view.cljc")
          w (slurp* "src/airyield/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
