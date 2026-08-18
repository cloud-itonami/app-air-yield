#!/usr/bin/env nbb
;; smoke-worker — 実際にビルドされた bundle を import して叩く。
;;
;; ここが「deploy される成果物」に触る唯一の検査である。unit test
;; (test/airyield/route_test.cljc) はソースの判断を固定するが、bundle が本当に
;; Worker の形で答えるかは言えない —— export の形、shadow の最適化、
;; `shadow.resource/inline` で焼いた CSS は、どれもビルドを通って初めて存在する。
;;
;; Usage:  nbb scripts/smoke-worker.cljs [<dist/worker.js>]
;; Exit:   0 全て期待どおり · 1 期待と違う · 2 判定できなかった（bundle が無い等）

(require '["node:fs" :as fs] '["node:path" :as path] '["node:url" :as url]
         '[clojure.string :as str])

(def bundle
  "ESM の import は相対パスを package 名と読むので、必ず絶対パスに直してから
  file:// URL にする（`dist/worker.js` をそのまま渡すと『Cannot find package
  dist』になる）。"
  (let [a (first (remove #(str/starts-with? % "--") *command-line-args*))]
    (.resolve path (or a "dist/worker.js"))))

(def failures (atom []))
(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" label
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))))

(when-not (.existsSync fs bundle)
  (println (str "UNDETERMINED\tno bundle at " bundle))
  (println "Refusing to report a pass: build it first (docs/operator-quickstart.md §4).")
  (js/process.exit 2))

(def sentinel
  "env の VALUE がページに出ていないことを確かめる印。実在しそうな値
  （\"yoro\" 等）だと二つの問題がある: 他の文言と偶然一致しうるし、引用符ごと
  探すと renderer が \" を &quot; に escape するので **決して一致しない** ——
  つまり検査が構造的に落ちなくなる。印を使えばどちらも起きない。"
  "SENTINEL-a1ry13ld-7c4e")

(def router-url
  "中継先は **値そのもの** がページに出る。ここを .invalid（RFC 2606 で必ず
  解決しない TLD）にしておくと、出ていることを実 DNS に依存せず確かめられる。"
  "https://mcp.example.invalid/xrpc/probe")

(def env #js {"APP_NANOID" "a1ry13ld"
              "APP_UI_TYPE" sentinel
              "AGENTGATEWAY_MCP_ROUTER_URL" router-url})

(defn- call [h method path]
  (let [req (js/Request. (str "https://air-yield.etzhayyim.com" path) #js {:method method})]
    (-> (js/Promise.resolve ((.-fetch h) req env #js {}))
        (.then (fn [res] (-> (.text res)
                             (.then (fn [body] {:status (.-status res)
                                                :ct (.get (.-headers res) "content-type")
                                                :body body}))))))))

(-> (js/import (.-href (.pathToFileURL url bundle)))
    (.then
     (fn [m]
       (let [h (.-default m)]
         (check! "default export has fetch" true (fn? (.-fetch h)))
         (-> (js/Promise.all
              #js [(call h "GET" "/") (call h "GET" "/health")
                   (call h "POST" "/xrpc/") (call h "OPTIONS" "/xrpc/x")
                   (call h "GET" "/nope") (call h "POST" "/health")])
             (.then
              (fn [[page health bad pre nf mna]]
                (check! "GET / status" 200 (:status page))
                (check! "GET / is html" true (str/includes? (or (:ct page) "") "text/html"))
                ;; ページは route 表から描かれる。表にある path が全部出ていること。
                (doseq [p ["/health" "/xrpc/:nsid"]]
                  (check! (str "page advertises " p) true (str/includes? (:body page) p)))
                (check! "page shows a var key" true (str/includes? (:body page) "APP_NANOID"))
                ;; 表示する値と表示しない値を **別々の印で** 見る。片方だけだと
                ;; 「全部隠す」実装も「全部出す」実装も通ってしまう。
                (check! "page hides other var values" false (str/includes? (:body page) sentinel))
                (check! "page shows the relay target it uses" true (str/includes? (:body page) router-url))
                ;; design system の主張は **2 つある** ので 2 本に割る。
                ;; 「dads-table が在る」だけでは落ちない —— それは view が出力する
                ;; markup であって、CSS が 1 バイトも入っていないページにも現れる。
                ;; 実測（このページ、2026-08-18）: `dads-table` は css 込み 74 /
                ;; css 無し **6**（0 にならない）。`--color-primitive-blue` は 45 / **0**。
                (check! "page uses the design system components" true
                        (str/includes? (:body page) "class=\"dads-table\""))
                (check! "page carries the stylesheet itself" true
                        (str/includes? (:body page) "--color-primitive-blue"))
                (check! "GET /health status" 200 (:status health))
                (check! "health names its routes" true (str/includes? (:body health) "/xrpc/:nsid"))
                ;; nsid 無しの XRPC だけが 400。多段は移行前と同じく転送する
                ;; （その転送先への実 fetch は smoke に入れない —— いま
                ;;  mcp.etzhayyim.com が NXDOMAIN であることに寄りかかる検査に
                ;;  なるため。多段の扱いは unit test が固定している）。
                (check! "POST /xrpc/ status" 400 (:status bad))
                (check! "OPTIONS preflight" 204 (:status pre))
                (check! "unknown path" 404 (:status nf))
                (check! "wrong method" 405 (:status mna))
                (let [f @failures]
                  (if (seq f)
                    (do (println (str "FAILED\t" (count f) " check(s): " (str/join ", " f)))
                        (js/process.exit 1))
                    (do (println "OK\tthe built bundle answers as the route table says")
                        (js/process.exit 0))))))))))
    (.catch (fn [e]
              (println (str "UNDETERMINED\tcould not exercise the bundle: " (.-message e)))
              (js/process.exit 2))))
