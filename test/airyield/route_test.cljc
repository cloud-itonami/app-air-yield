(ns airyield.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.string :as str]
            [airyield.route :as route]
            [airyield.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (testing "method は大文字小文字を問わない"
    (is (= :page (:action (route/dispatch "get" "/"))))))

(deftest dispatch-xrpc
  (testing "nsid をそのまま渡す"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.airYield.publishFareClass"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.airYield.publishFareClass"))))
  (testing "空だけが 400。多段は移行前の [...path] と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (testing "末尾スラッシュは落とす"
    (is (= "https://a.example/x"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"}))))
  (testing "空白だけの設定は未設定として扱い、次の候補へ落ちる"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (= {:ok? true :value "plain"} (route/unwrap-mcp "plain")))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}}))))
  (is (= "boom" (:error (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。固定値を焼かない（この移行が消した欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_NANOID"))
      (is (str/includes? html "https://mcp.example/x"))
      (testing "移行前のページが出していた偽の文言は出ない"
        (is (not (str/includes? html "No public route is declared")))
        (is (not (str/includes? html "No public vars are declared"))))))
  (testing "route 表が変われば表示も変わる —— ページは渡されたものを描く"
    (let [html (view/render {:css "" :routes [{:route/path "/only" :route/method :get
                                               :route/kind :page :route/doc "唯一"}]
                             :vars [] :mcp-url "https://m.example"})]
      (is (str/includes? html "/only"))
      (is (not (str/includes? html "/xrpc/:nsid"))))))

(deftest relay-headers-forwards-what-it-received
  (testing "移行前は host を削るだけで、authorization も上流へ届いていた"
    (let [h (route/relay-headers [["Host" "x.example"]
                                  ["Authorization" "Bearer t"]
                                  ["Content-Length" "9"]
                                  ["Content-Encoding" "gzip"]
                                  ["X-Trace" "abc"]]
                                 "com.a.b")]
      (is (= "Bearer t" (get h "authorization"))
          "authorization が落ちている —— preflight はこれを許可すると言っている")
      (is (= "abc" (get h "x-trace"))
          "呼び手が付けた header が落ちている")
      (is (nil? (get h "host")) "host は宛先が変わるので渡さない")
      (is (nil? (get h "content-length")) "body を詰め直すので元の長さは嘘になる")
      (is (nil? (get h "content-encoding")) "body を詰め直すので元の encoding も嘘になる")
      (is (= "application/json" (get h "content-type")))
      (is (= "com.a.b" (get h "x-etzhayyim-xrpc-method")))
      (is (= "cljs-worker" (get h "x-etzhayyim-bff"))))))
