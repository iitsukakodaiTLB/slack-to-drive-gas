# slack-to-drive-gas

Slack の会話ログを Google Drive に同期する **Google Apps Script** と、将来追加する **管理用 Web UI** を、このリポジトリで管理します。

## レイアウト

| パス | 内容 |
|------|------|
| `gas/slack-sync-worker/` | 同期ワーカー（`code.js`, `Config.js`, `appsscript.json`, `.clasp.json`） |
| `gas/admin-web-ui/` | 管理 Web UI 用（別 GAS。セットアップ後に clasp 設定を置く） |
| `docs/` | 設計・要件メモ |

## 前提

- Node.js 20+
- [clasp](https://github.com/google/clasp)（`npm install` で devDependency として入る）

## clasp（ルートから npm で実行）

ログイン・ログアウトはルートで実行します。

```bash
npm install
npm run clasp:login
```

**同期ワーカー**（`gas/slack-sync-worker`）:

```bash
npm run clasp:push:sync
npm run clasp:pull:sync
npm run clasp:open:sync
npm run clasp:logs:sync
```

**管理 Web UI**（`gas/admin-web-ui` に `.clasp.json` がある場合）:

```bash
npm run clasp:push:admin
npm run clasp:pull:admin
```

初回のみプロジェクト作成・クローン例（同期ワーカー用ディレクトリで）:

```bash
cd gas/slack-sync-worker
clasp create --type standalone --title slack-sync-worker
# 既存プロジェクトを引き継ぐ場合:
# clasp clone <SCRIPT_ID>
```

## ドキュメント

- [Slack ログ同期の設計提案](docs/slack-log-sync-design-proposal.md)
- [管理用 Web UI 要件（たたき）](docs/admin-web-ui-requirements.md)
