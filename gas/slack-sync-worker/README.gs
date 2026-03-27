/**
 * GAS-side README.
 *
 * How to use:
 * 1) Run showReadmeInLog() to output this README to execution logs.
 * 2) Run showReadmeDialog() to open a dialog in Spreadsheet UI (when available).
 * 3) Keep this content updated together with code changes.
 */

const README_MD = `
# slack-to-drive-gas README (GAS)

## 概要

Slack のチャンネルログを定期取得し、Drive に CSV / JSONL で保存します。

- ファイル名: \`{channel_name}__{channel_id}__{part_no}\`
- シート: \`channel_sync_state\`, \`thread_queue\`, \`slack_user_cache\`
- 再開制御: \`history_oldest_ts\`, \`history_next_cursor\`, \`replies_next_cursor\`

---

## 定期実行のメイン関数

- \`runSlackLogSync()\`
  - 1回分の同期処理を実行
  - 対象行選定 -> ロック -> history/replies取得 -> Drive追記 -> ステータス更新

---

## 初期化/確認

- \`bootstrapSheets()\`
  - シートが無ければ作成し、空ならヘッダーを投入
- \`healthCheck()\`
  - Script Properties とシートヘッダーの整合確認

---

## トリガー管理

- \`setupFiveMinuteTrigger()\`
  - \`runSlackLogSync\` の5分間隔トリガーを再作成
  - 同名ハンドラの既存トリガーは削除してから作成
- \`deleteRunSlackLogSyncTriggers()\`
  - \`runSlackLogSync\` のトリガーを全削除

---

## 管理用関数（運用）

- \`resumeChannel(channelId)\`
  - \`DISABLED\` / \`ERROR\` から復帰させる
  - \`status=WAITING\`, 失敗情報クリア, ロッククリア
- \`disableChannel(channelId, reason)\`
  - チャンネルを手動停止
  - \`status=DISABLED\` に更新し、\`note\` に理由を記録

### 典型運用

1. \`not_in_channel\` などで停止
2. Slack側の設定を修正（Bot招待や権限修正）
3. \`resumeChannel("Cxxxxxxx")\` を実行
4. 次回トリガーで再開

---

## Script Properties（必須）

- \`SLACK_BOT_TOKEN\`
- \`SPREADSHEET_ID\`
- \`DRIVE_ROOT_FOLDER_ID\`

---

## シート作成時ヘッダー（1行目）

### channel_sync_state

\`\`\`csv
status,channel_id,channel_name_current,priority_interrupt_at,sort_last_run_at,live_last_message_at,sync_mode,backfill_completed_at,history_oldest_ts,history_next_cursor,history_inclusive,live_last_message_ts,thread_current_parent_ts,replies_next_cursor,thread_queue_ref,drive_csv_current_part,drive_jsonl_current_part,drive_csv_current_file_id,drive_jsonl_current_file_id,drive_last_renamed_at,lock_owner,lock_until,last_success_at,last_error_at,last_error_message,consecutive_failures,registered_at,registered_by,note
\`\`\`

### thread_queue

\`\`\`csv
queue_id,channel_id,parent_thread_ts,status,replies_next_cursor,last_reply_ts_processed,lock_owner,lock_until,last_error_at,last_error_message,retry_count,updated_at,created_at
\`\`\`

### slack_user_cache

\`\`\`csv
user_id,display_name,real_name,is_bot,is_deleted,updated_at
\`\`\`

---

## 補足

- \`thread_queue\` の \`DONE\` は 90日超で削除されます。
- \`users.info\` は未キャッシュ \`user_id\` のみ呼びます。
- リアクションは \`history/replies\` のレスポンスから整形します（追加APIなし）。
`;

function showReadmeInLog() {
  Logger.log(README_MD);
}

function getReadmeMarkdown() {
  return README_MD;
}

function showReadmeDialog() {
  const html = HtmlService.createHtmlOutput(
    "<pre style='white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;'>" +
      escapeHtml_(README_MD) +
      "</pre>"
  )
    .setWidth(900)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, "slack-to-drive-gas README");
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
