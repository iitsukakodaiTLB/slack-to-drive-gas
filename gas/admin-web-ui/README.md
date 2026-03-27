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

## Phase 3（詳細・保存）

- 一覧の **編集** から行を開き、全列を参照しつつ **status**（許可遷移のみ）・**priority_interrupt_at**・**note** を更新可能。
- 保存時に `ui_last_updated_at` と `ui_last_updated_by`（デプロイ担当者メール、空の場合あり）を更新。
- `RUNNING` 中は **status のみ**変更不可（note / 優先割り込みは可）。

## Phase 4（新規チャンネル登録）

- 画面上部のフォームから **チャンネル名**を入力し、`conversations.list` で **public / private（非アーカイブ）**を走査して名前一致（`#` 除去・小文字）で `channel_id` を決定。
- 既に `channel_sync_state` に同じ `channel_id` があれば登録しない。
- Bot に **channels:read**（private には **groups:read** 相当・チャンネルへの参加）が必要。`SLACK_BOT_TOKEN` を Script Properties に設定すること。

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
