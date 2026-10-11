# 夏躺工作表單：專案備忘錄

這份備忘錄給之後維護這個專案的人（主要是 Claude）。修改程式前先讀完，就能掌握架構、規則和已知的坑。

## 這是什麼

- Podcast「夏日只想躺在家」（簡稱夏躺）和廣告代理商「播客煮」用來同步業配的網站。
- 播客煮接業配、填合作細節。夏躺看排程和截止日。雙方報價各拿 50%。
- 管理者（genwie@gmail.com，吳浚瑋）另外有每季薪資結算：
  - 剪輯夥伴曼達每集領剪輯費，扣掉其他支出後，盈餘兩人均分。
- 正式網址：https://xiatang-board.web.app
- GitHub：genwie-wu/xiatang-board（公開 repo；推到 main 會自動部署）
- 計畫書（需求、決定、測試清單）：Claude Docs「夏躺工作表單 計畫書」，https://claude.ai/code/artifact/8c1c5276-c634-4071-bdd2-360c5ed0f3ea
  - 功能有變時，計畫書也要一起更新。
- 程式備份：使用者電腦 `~/Desktop/夏躺工作表單/網站程式/`。改完程式也同步一份過去；`.github/` 底下的檔案寫不進去，是正常的。

## 跟使用者合作的方式（重要）

- 使用者沒有程式背景。說明一律用白話中文，不要用術語。
- 新需求的流程：
  1. 先寫進計畫書、列出不清楚的問題（附建議答案），等使用者回覆。
  2. 使用者說「開始」才動工。
- 能代勞的都直接做；只有「本人才能做」的步驟才停下來，逐步引導使用者。
  - 本人才能做的事：登入、按 Google 彈出視窗（瀏覽器不讓 Claude 代點）、授予 IAM 角色（自動模式會擋）、建立或貼上金鑰、綁卡或升級方案。
  - 給 IAM 指令時，用 Cloud Shell 一次貼上整段 `gcloud` 指令最省事。
- 要花錢的功能，先說明費用和設定方式。
- Commit 訊息用中文，作者用 `genwie-wu <genwie@gmail.com>`。

## 技術架構總覽

```
瀏覽器（public/，純 HTML + 原生 JS 模組，沒有打包工具）
   │  Firebase JS SDK 10.12.2（從 gstatic CDN 匯入）
   ├─ Firebase Auth：Google 登入（signInWithPopup）
   ├─ Firestore：所有資料，即時訂閱（onSnapshot）
   ├─ Google 日曆 API：瀏覽器直接呼叫（Google Identity Services 取權杖）
   └─ FCM 推播：push.js 取權杖存進 pushTokens，sw.js 顯示通知

Cloud Functions（functions/，Node 22，第 2 代，asia-east1）
   └─ 監聽 Firestore 變動 → 建立 notifications → 推播到使用者裝置

部署：GitHub Actions（.github/workflows/deploy.yml）
   └─ firebase-tools deploy --only hosting,firestore:rules,functions
```

- Firebase 專案：`xiatang-board`。Blaze（用多少付多少）方案，帳單已連結。
  - 使用者設了約 NT$30 的預算提醒信。
  - Cloud Functions 需要 Blaze；其他功能都在免費額度內。
- Firestore 位置：`asia-east1`（台灣），Standard 版。

## 檔案地圖

| 路徑 | 內容 |
| --- | --- |
| `public/index.html` | 外殼；`app.js?v=N`、`style.css?v=N` 用版本號強制更新快取 |
| `public/app.js` | 整個網站（約 1200 行），用註解分成好幾區，見下方 |
| `public/config.js` | Firebase 設定、日曆用的 OAuth 用戶端 ID、`ownerEmail`；這些值本來就公開 |
| `public/push.js` | 推播：判斷裝置是否支援、要通知權限、取得或刪除 FCM 權杖（參考使用者另一個專案 genwie-wu/singnseek 的做法） |
| `public/sw.js` | Service worker：可加到主畫面；收到 push 時自己顯示通知；點通知會打開對應頁面。不快取任何東西 |
| `public/style.css` | 所有樣式；顏色變數在 `:root`，有深色模式 |
| `public/icons/` | 由使用者的 `cover.JPG`（冰藍色果凍「夏」字）裁切出的圖示與登入頁大圖 |
| `public/manifest.webmanifest` | 加到主畫面用（名稱「夏躺」） |
| `firestore.rules` | 資料庫權限規則（部署時一併上傳，是唯一的真相來源） |
| `functions/index.js` | 伺服器程式：5 種通知觸發，加上推播發送 |
| `firebase.json` / `.firebaserc` | 部署設定；`*.js/css/html` 一律 `no-cache` |
| `tests/` | 本機冒煙測試（假的 Firebase + Playwright 截圖） |

### `public/app.js` 的分區（照檔案順序）

1. **常數與小工具**：`ROLES`、`DEFAULT_LINKS`、`DEFAULT_SETTINGS`、日期工具。
2. **狀態**：全域物件 `S`，包含資料、`S.ui`、`S.notes`；以及 `role()`、`isAdmin()`、`isMember()`、`canEdit()`、`ratio()`。
3. **合作資料的計算**：`epsSorted`、`epValue`（報價平分到每集）、`isAired`、`airStatus`、`allEpisodes`、`monthIncome`。
4. **畫面外框**：`renderShell` 負責頂部導覽、手機底部導覽、小鈴鐺、帳號選單。
5. **登入 / 待開通**：`renderLogin`、`renderPending`。
6. **首頁**：`renderHome`，包含本月收益、常用連結、合作列表（進行中／已結束、依日期／產品排序），以及推播提示。
7. **合作細節**：`renderDeal`。
8. **發票與入帳**：`billingBlock`、`setInvoiced`、`setPaid`（還沒開發票就勾入帳會先跳提醒）、`bindBilling`。
9. **新增 / 編輯合作**：`openDealForm`。驗證規則：
   - 上線日必須是週三。
   - 截止日要早於上線日。
   - 同一週三撞期時跳確認。
   - 存檔前先取得日曆權杖，避免彈出視窗被擋。
10. **排程表**：`renderSchedule` 列出該月每個週三（沒業配也列），以及本月截止事項。
11. **每月收入**：`renderIncome`。
12. **季度薪資結算**：`computePayroll`、`payrollText`（給 LINE 用的明細）、`renderPayroll`。
13. **管理**：`renderAdmin`，包含帳號身份、常用連結、設定。
14. **Google 日曆同步**：`getCalToken`、`syncCalendar`。
15. **通知**：小鈴鐺、通知清單、推播開關、`logout`（登出時刪掉這台裝置的推播權杖）。
16. **小元件**：`toast`、`confirmBox`（自製的確認視窗，不用原生 `confirm`）、`copyText`。
17. **路由與資料訂閱**：
    - 路由用 hash：`#home`、`#schedule`、`#income`、`#payroll`、`#admin`、`#deal/<id>`。
    - `startDataSubs` 依身份決定訂閱哪些資料。
    - `ensureProfile`：第一次登入時建立帳號資料。
    - `seedDefaults`：管理者第一次登入時，放入預設連結和設定。

畫面做法：每個 `renderXxx()` 直接組 HTML 字串放進 `#app`，再綁定事件；資料變動就重畫（`scheduleRender`）。
- 使用者正在輸入、或有開啟的表單時會延後重畫，避免打字被打斷。
- 所有使用者輸入都要經過 `esc()` 再放進 HTML。

## 資料模型（Firestore）

| 集合 | 欄位 | 誰能讀／寫 |
| --- | --- | --- |
| `users/{uid}` | `email, name, photoURL, role, createdAt, lastLogin` | 讀：本人或管理者；改身份：只有管理者 |
| `deals/{id}` | `brand, briefUrl, quote(未稅), stories, otherSocial, note, episodes[], createdBy, updatedBy, deletedBy?` | 讀：成員；寫：播客煮、管理者 |
| `deals.episodes[]` | `id, airDate, minutes, scriptDue, roughCutDue, infoText, cal{air,script,cut}` | 依上線日排序後存 |
| `payments/{dealId}` | `invoiced, invoiceDate, invoiceNo, paid, paidDate, brand, updatedBy` | 讀：成員；寫：管理者 |
| `links/{id}` | `name, url, order` | 讀：成員；寫：管理者 |
| `settings/general` | `shareRatio(%), editFee, splitCount, editorName, ownerName, calendarId` | 讀：成員；寫：管理者 |
| `settings/seeded` | 標記「預設連結已放過」 | 同上 |
| `expenses/{id}` | `date, item, payee, amount` | 只有管理者 |
| `quarters/{2026Q3}` | `episodeCount?(手動覆寫), locked, lockedAt, lockedBy, snapshot` | 只有管理者 |
| `notifications/{id}` | `uid, title, body, link(#deal/..), read, createdAt` | 只有伺服器建立；本人可讀、標已讀、刪除 |
| `pushTokens/{hash}` | `uid, token, device, updatedAt` | 本人寫自己的；伺服器讀 |

身份（`role`）共四種：
- `pending`：待開通，新帳號預設，什麼都看不到。
- `xiatang`：夏躺人員，例如曼達。只能看，不能改合作，也看不到薪資結算。
- `bokezhu`：播客煮人員，可以新增、修改、刪除合作。
- `admin`：管理者。

另外 `genwie@gmail.com` 寫死在規則、`config.js` 和 functions 裡，永遠是管理者。

## 重要的商業規則

- **日期**：一律用台北時間的 `"YYYY-MM-DD"` 字串比較（`todayStr()`）。不要用 `Date` 物件比日期。
- **上線**：節目每週三 0:00 上線。上線日當天就算「已上線」，也就是「結案」。
- **收入**：報價是未稅金額。多集合作的報價平均分到每一集，依各集上線月份算進每月收入。夏躺／播客煮的比例取 `settings.shareRatio`，預設 50。
- **薪資結算**（每季，季度照月曆切：1–3、4–6、7–9、10–12 月；預設顯示上一季）：
  1. 收入：只算「已入帳」的夏躺分潤，依「入帳日」決定歸哪一季。
  2. 剪輯費 = 本季集數 × `editFee`（預設 3000）。集數預設是本季週三的數量，可以手動覆寫。
  3. 盈餘 = 收入 − 剪輯費 − 其他支出；盈餘大於 0 才均分（`splitCount`，預設 2）。
  4. 曼達應付 = 剪輯費 + 均分；管理者應得 = 均分。
  5. 盈餘小於或等於 0 時，顯示「本季不分配」，曼達仍然領全額剪輯費。
  6. 按「完成結算」後存一份快照並鎖定，之後資料再改也不影響這一季。可以「解鎖重算」。
  7. 網站只算應付金額，不處理扣繳稅款。
- **發票**：上線後由夏躺開發票給播客煮，播客煮付款後才入帳。應開發票金額 = 夏躺分潤，含稅金額 ×1.05（只供參考）。結算頁的底色：
  - 黃底：已上線、還沒開發票。
  - 藍底：已開發票、等待入帳。

## Google 日曆同步

- 共用日曆「夏躺業配」，ID 存在 `settings.calendarId`。預設值寫在 `DEFAULT_SETTINGS`。
- 瀏覽器用 Google Identity Services 的 token client 取得權杖（範圍 `calendar.events`），用的是 Firebase 自動建立的 Web OAuth 用戶端。
  - 這個 OAuth 用戶端的「已授權 JavaScript 來源」必須包含正式網址（https://xiatang-board.web.app，目前已加）。
  - OAuth 應用程式沒有送 Google 驗證，所以使用者第一次會看到「未經驗證的應用程式」，按「進階」再「前往」就能繼續。人數上限 100。
- 每一集建立 3 個全天事件：【上線】、【口播稿截止】、【初剪截止】。事件 ID 存在 `episodes[].cal`。
  - 修改合作時用 PUT 更新；事件不見了就重建。
  - 刪除集數或合作時，一併刪掉事件。
- 存檔的人必須有這個日曆的「變更活動」權限，否則會顯示錯誤，但合作本身照樣存檔。

## 通知與推播

- `functions/index.js` 監聽以下變動，在 `notifications` 建立通知。做動作的人（`createdBy`、`updatedBy`、`deletedBy`、`lockedBy`）不會收到：

  | 觸發 | 收到通知的人 |
  | --- | --- |
  | 新增合作 | 夏躺人員、管理者 |
  | 改到上線日或截止日 | 夏躺人員、管理者（改資訊欄、備註等不通知） |
  | 刪除合作 | 夏躺人員、管理者 |
  | `payments.invoiced` 由否變是 | 夏躺人員、播客煮 |
  | `quarters.locked` 由否變是 | 夏躺人員（內容不寫金額） |

- `pushNotification`：每建立一則通知，就用 `sendEachForMulticast` 送 data 訊息到這個人所有的 `pushTokens`；失效的權杖會自動刪掉。
- 推播是 data 訊息，由 `sw.js` 自己顯示通知；連結是 `https://xiatang-board.web.app/#deal/...`。
- 用戶端：`push.register()` 不帶 VAPID 金鑰，用 Firebase 預設的金鑰，並用自己的 `sw.js` 註冊。權杖做 SHA-256 雜湊後當文件 ID，`localStorage` 記住這台裝置的 ID。
- iPhone 要 iOS 16.4 以上，而且要「加入主畫面」後從圖示打開才能開通知；LINE 等 App 內建的瀏覽器不行。`push.support()` 會分辨這些情況並顯示對應說明。
- 新增有「做動作的人」的寫入時，記得帶上 `updatedBy: S.user.email`，伺服器才知道要排除誰。

## 部署與權限（踩過的坑）

- 推到 `main` 會觸發 GitHub Actions：先 `npm ci --prefix functions`，再用 secret `FIREBASE_SERVICE_ACCOUNT`（JSON 金鑰）部署。
  - 部署失敗時，錯誤訊息會變成 annotation。查看方式：
    1. 用 `GET /repos/genwie-wu/xiatang-board/commits/<sha>/check-runs` 找到名為 `deploy` 的 check run。
    2. 再看它的 `/annotations`。
    3. 這是公開 repo，GitHub API 不用登入就能查。
  - 想重跑部署：推一個空的 commit（`git commit --allow-empty`）。這裡的 `gh` 沒有有效權杖。
- 部署帳號是 `github-deploy@xiatang-board.iam.gserviceaccount.com`，角色有：
  - Firebase 託管管理員、Firebase 規則管理員、服務使用情形消費者
  - Firebase 管理員、Cloud Functions 管理員、服務帳戶使用者、Artifact Registry 管理員
- 第一次部署 functions 時另外補過三個 Google 內部帳號的權限（使用者用 Cloud Shell 貼指令）：
  - pubsub 服務代理：`iam.serviceAccountTokenCreator`
  - compute 預設帳號：`run.invoker`、`eventarc.eventReceiver`
- 已開啟的 API：Cloud Functions、Cloud Build、Artifact Registry、Cloud Run、Eventarc、Pub/Sub、FCM、Cloud Storage、Cloud Billing、Firebase Extensions、Google Calendar。
- 第 2 代 functions 第一次部署常出現「Eventarc Service Agent 權限」錯誤。這是權限還在生效中，等 3–5 分鐘重部署就好。
- Claude 的雲端工作環境連不到 Google 的 API，也連不到 xiatang-board.web.app，只能透過 GitHub Actions 部署。要檢查正式網站或 Google 控制台，用使用者電腦上的內建瀏覽器。
- 改了 `app.js` 或 `style.css` 後，記得把 `public/index.html` 裡的 `?v=` 加 1。
  - `config.js` 和 `push.js` 是用 `?v=1` 匯入的；改這兩個檔時，也要更新 `app.js` 裡的匯入版本號。

## 本機測試

- 工作環境連不到 Firebase，所以用 `tests/mock/` 裡的假 SDK：
  - 資料放在記憶體，從 `window.__store` 讀進來；登入使用者由 `window.__mockUser` 決定。
  - 測試時攔截 gstatic 的網址，改用這些假模組。
- 執行 `python3 tests/ui_smoke.py u1 home,payroll,deal/d1 desktop`，截圖會存到 `tests/out/`。
  - 使用者代號：u1 管理者、u2 夏躺人員、u3 播客煮、u4 待開通。
  - 假資料寫在 `tests/ui_smoke.py` 的 `seed` 裡。
- 要測互動（填表、按按鈕）時，照同樣方式寫 Playwright 腳本：`page.click` / `fill`，再讀 `window.__store` 驗證寫進去的資料。
- 推播和日曆無法在本機測，要上線後請使用者用真的手機或帳號測。

## 目前狀態與待辦

- 第一到第三輪功能都已上線：
  - 合作、排程、收入、結算、帳號、連結、日曆同步。
  - 發票欄位、小鈴鐺、推播。
- 推播還沒在真的手機上驗證過（等使用者回報）。
- 還有測試資料「【測試】好眠床墊」，使用者測完會刪除。
- 小清理（不急）：Firebase「授權網域」和 OAuth 來源裡還留著已停用的 `genwie-wu.github.io`，可以移除。
