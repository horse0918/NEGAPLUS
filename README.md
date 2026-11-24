# NEGA+ PWA

把 dist/ 部署到 HTTPS，可使用單字卡、詞庫更新、加入主畫面和離線快取。Browser 須先在線載入並完成快取。iPhone 用 Safari 開啟網址，從分享選單選「加入主畫面」。

Windows 本機預覽可雙擊「開啟 NEGA+ PWA.cmd」，需有 Node.js。此方式可試用單字卡。

上層 words.json 是編輯來源。更新後複製到 dist/words.json 並重新部署。每次開啟時從網路取新版，離線則使用快取。

要在關閉 App 後收到通知，部署整個 PWA 資料夾到可長時間執行 Node.js 及保留磁碟資料的主機，從同一 HTTPS 網址提供頁面與 API。靜態部署沒有推播 API。iPhone Web Push 需要 iOS 16.4 以上，從主畫面圖示開啟後允許通知。

- npm install
- npm run push:keys
- 設定環境變數 VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT。聯絡用 SUBJECT 格式為 mailto:你的信箱。
- npm start 。本機預設 http://127.0.0.1:8787，部署時可設定 HOST=0.0.0.0 及 PORT，並由主機或反向代理提供 HTTPS。
- 使用經由 HTTPS 存取的持續執行服務，將 NEGA_STATE 指向持久磁碟上的 JSON 檔並以單程序執行。訂閱資料只儲存在該檔，維持同一組 VAPID 金鑰，勿提交金鑰或訂閱檔。
- 用主畫面 App 點「試推一個字」，再儲存起訖時間和間隔。排程以儲存時的裝置時區為準。

這個伺服器會在開始時間起依分鐘間隔發送，包含剛好落在結束時間的時段，並支援跨午夜。伺服器停止期間不補發。
