# admin-web-ui（管理用 GAS Web アプリ）

## Script Properties（必須）

| キー | 説明 |
|------|------|
| `SPREADSHEET_ID` | 設定用スプレッドシート ID（同期ワーカーと同じ） |
| `SLACK_BOT_TOKEN` | 新規チャンネル登録（Slack API）用。Phase 4 以降で使用 |

## 初回セットアップ

1. スクリプトエディタ → **プロジェクトの設定** → **スクリプト プロパティ** に上記を追加
2. **デプロイ** → **新しいデプロイ** → 種類「ウェブアプリ」
   - **次のユーザーとして実行: 自分（デプロイした Google アカウント）** を推奨  
     - スプレッドシートは **このアカウントに編集権限**があればよい。来訪者にシートを共有する必要はない。
     - 読み書きはすべてデプロイ担当者の権限で行われる。
   - **アクセスできるユーザー:** 組織内のみ（要件どおり）

## Phase 2（一覧）

- トップ画面で `channel_sync_state` の**読み取り一覧**（`status` フィルタ・エラーのみ・ページング）。
- 行番号（`sheetRow`）は Phase 3 の詳細編集で使用予定。

## 操作者ログについて（方針）

- **来訪者ごとのメール（誰がボタンを押したか）は記録しない**前提とする。
- `ui_last_updated_at` は Web UI から更新した**日時**を記録してよい。
- `ui_last_updated_by` は **空**、または **常にデプロイ担当者のメール**（`Session.getEffectiveUser()`）など、実装で統一する（同一値の繰り返しになり区別には使えない）。

## clasp

リポジトリルートから:

```bash
npm run clasp:push:admin
```

または:

```bash
cd gas/admin-web-ui && clasp push
```

## 関連ドキュメント

- [管理 Web UI 要件](../../docs/admin-web-ui-requirements.md)
- [同期設計提案](../../docs/slack-log-sync-design-proposal.md)
