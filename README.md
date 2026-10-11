# 夏躺工作表單

夏日只想躺在家 × 播客煮 業配合作工作表單。

- 網站：https://xiatang-board.web.app
- 網站檔案在 `public/`；資料庫權限規則在 `firestore.rules`
- 推送到 main 後，GitHub 會自動上傳到 Firebase（`.github/workflows/deploy.yml`，需要 `FIREBASE_SERVICE_ACCOUNT` 金鑰）
- 專案備忘錄（架構、資料、規則、部署方式）：`CLAUDE.md`
- 本機畫面測試：`python3 tests/ui_smoke.py u1 home desktop`
