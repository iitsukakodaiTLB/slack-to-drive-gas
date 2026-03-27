# Slack ログ取得・Drive 保存（GAS）設計提案

スタンドアロン GAS、スプレッドシート `slack_log_to_drive_setting`、Drive フォルダ `slack_log_to_drive` を前提にした、確定方針ベースの設計メモです。

---

## 1. 確定方針（今回反映）

- ログ本体は**シートに保存しない**。Drive に保存し更新する。
- 1 チャンネルにつき `CSV` と `JSONL` を管理するが、NotebookLM の 1 ファイル制約を超える可能性を見越して**分割前提**とする。
- ファイル名に**チャンネル名 + チャンネル ID**を含め、**チャンネル ID を正**として読み書き対象を特定する。
- 分割ファイルは末尾に**2 桁連番**を付ける。
- シート列は `ログ取得終了日時` を廃止し、**Slack API カーソル (`ts` / `next_cursor`) 中心**へ変更する。
- `取得中` のまま落ちても、次回で**必ず途中再開**できる設計にする。
- 優先度は要件どおり、`優先割り込み_at` 優先、同順位は `sort_last_run_at` または `live_last_message_at` の古い順。
- チャンネル改名時は、該当チャンネル ID の**分割済み全 CSV/JSONL を一括リネーム**する。
- `thread_queue` の `DONE` は同一シートで管理し、保持期限（90日）超過分を定期削除する。
- 保存項目はスリム化しつつ、`user_name` と `reaction_summary` は保持する。
- API コスト抑制のため、`chat.getPermalink` は呼ばない。`users.info` は未キャッシュ `user_id` のみ呼ぶ。
- **管理 Web UI** は同期ワーカーとは別 GAS。`channel_sync_state` の末尾に **`ui_last_updated_at` / `ui_last_updated_by`** を置き、Web UI 経由の最終更新者を記録する（同期ワーカーは当該列を**更新しない**）。任意で **`admin_ui_audit`** シートに操作ログを追記する。要件の正本は [admin-web-ui-requirements.md](./admin-web-ui-requirements.md)。

---

## 2. Drive ファイル命名規則（分割前提）

### 2.1 推奨命名

- CSV: `{channel_name_sanitized}__{channel_id}__{part_no}.csv`
- JSONL: `{channel_name_sanitized}__{channel_id}__{part_no}.jsonl`
- `part_no`: `01`, `02`, `03` ...（2 桁固定）

例:

- `general__C01234567__01.csv`
- `general__C01234567__01.jsonl`

### 2.2 取り扱いルール

- 認識キーは**`channel_id`**。`channel_name` は表示・命名用。
- 同一 `channel_id` のファイル群を「同一チャンネルの全ログ」とみなす。
- 最新 part は「最大 `part_no`」で判定。
- チャンネル改名時は、同一 `channel_id` の全 part を新しい `channel_name_sanitized` でリネーム。
- 禁止文字（`/ \ : * ? " < > |` 等）と前後空白はサニタイズ。

### 2.3 分割ポリシー

- 設定値 `MAX_BYTES_PER_FILE`（または `MAX_LINES_PER_FILE`）を超える見込みなら次 part を作成。
- CSV / JSONL は**同じ part 番号**で揃える（`01` 同士、`02` 同士）。
- シートには現在書き込み中の part 番号を持つ。

---

## 3. CSV / JSONL 項目（チャンネル列なし）

チャンネル情報はファイル名とシート行で確定できるため、ログ本文の列から `channel_id` / `channel_name` は除外する。


| 列 / キー             | 説明                |
| ------------------ | ----------------- |
| `message_ts`       | メッセージ `ts`（主キー相当） |
| `thread_ts`        | スレッドルート `ts`      |
| `parent_ts`        | 返信時の親 `ts`        |
| `user_id`          | 投稿者 ID            |
| `user_name`        | 解決後ユーザー名          |
| `datetime_utc`     | ISO8601           |
| `text`             | 本文                |
| `subtype`          | 例: `file_share`   |
| `reaction_summary` | 例: `thumbsup:3\|eyes:1` |
| `has_files`        | true/false        |


補足:

- JSONL は AI 用主形式、CSV は人間確認用の副形式にする。
- 重複排除キーは最小で `message_ts`、より厳密には `message_ts + parent_ts` なども検討可。
- `reaction_summary` は `conversations.history` / `conversations.replies` の `reactions` 情報のみで生成する（追加 API 呼び出しなし）。
- `user_name` は `slack_user_cache` を優先し、未キャッシュの場合のみ `users.info` で取得してキャッシュ更新する。
- `permalink` は保存しない（API コスト抑制）。

---

## 4. `channel_sync_state` シート列（全面改訂案）

`ログ取得終了日時` は廃止し、再開可能性と重複防止を優先した列構成に変更する。

### 4.1 列一覧（推奨）


| No  | 列名                            | 目的                                               |
| --- | ----------------------------- | ------------------------------------------------ |
| 1   | `status`                      | `PENDING / RUNNING / WAITING / ERROR / DISABLED` |
| 2   | `channel_id`                  | 主キー（不変）                                          |
| 3   | `channel_name_current`        | 最新チャンネル名（表示/命名用）                                 |
| 4   | `priority_interrupt_at`       | 優先割り込み日時                                         |
| 5   | `sort_last_run_at`            | 最終試行時刻（優先度ソート用）                                  |
| 6   | `live_last_message_at`        | 最終成功取り込み時刻（可読）                                   |
| 7   | `sync_mode`                   | `BACKFILL` or `LIVE`                             |
| 8   | `backfill_completed_at`       | バックフィル完了時刻（未完は空）                                 |
| 9   | `history_oldest_ts`           | `conversations.history` の次回 `oldest`（排他）         |
| 10  | `history_next_cursor`         | `conversations.history` ページ継続用                   |
| 11  | `history_inclusive`           | API パラメータの固定値メモ                                  |
| 12  | `live_last_message_ts`        | 増分同期の境界 `ts`（排他）                                 |
| 13  | `thread_current_parent_ts`    | `replies` 処理中の親 `ts`                             |
| 14  | `replies_next_cursor`         | `conversations.replies` ページ継続用                   |
| 15  | `thread_queue_ref`            | スレッドキュー参照キー（別シート推奨）                              |
| 16  | `drive_csv_current_part`      | 現在書き込み先の CSV part（`01` 等）                        |
| 17  | `drive_jsonl_current_part`    | 現在書き込み先の JSONL part                              |
| 18  | `drive_csv_current_file_id`   | 現在 part の CSV fileId                             |
| 19  | `drive_jsonl_current_file_id` | 現在 part の JSONL fileId                           |
| 20  | `drive_last_renamed_at`       | 改名対応を最後に実施した時刻                                   |
| 21  | `lock_owner`                  | 実行 UUID（リース所有者）                                  |
| 22  | `lock_until`                  | リース期限                                            |
| 23  | `last_success_at`             | 最終成功時刻                                           |
| 24  | `last_error_at`               | 最終失敗時刻                                           |
| 25  | `last_error_message`          | エラー要約                                            |
| 26  | `consecutive_failures`        | 連続失敗回数                                           |
| 27  | `registered_at`               | 登録日時                                             |
| 28  | `registered_by`               | 登録者                                              |
| 29  | `note`                        | 備考                                               |
| 30  | `ui_last_updated_at`          | 管理 Web UI 経由で当該行が最後に更新された日時（同期ワーカーは触らない）        |
| 31  | `ui_last_updated_by`          | 上記操作を行った Google ユーザーのメール（`Session.getActiveUser()`）   |


### 4.2 追加シート（推奨）

#### `thread_queue` シート

`conversations.replies` を確実再開するため、親スレッドを別管理する。


| 列名                        | 内容                                 |
| ------------------------- | ---------------------------------- |
| `queue_id`                | 一意 ID                              |
| `channel_id`              | 対象チャンネル                            |
| `parent_thread_ts`        | 親 `thread_ts`                      |
| `status`                  | `PENDING / RUNNING / DONE / ERROR` |
| `replies_next_cursor`     | ページ再開カーソル                          |
| `last_reply_ts_processed` | 重複防止用                              |
| `updated_at`              | 更新日時                               |

#### `admin_ui_audit` シート（任意・推奨）

管理 Web UI からの操作の**追記専用ログ**。同期ワーカーは読み書きしない。

| 列名 | 内容 |
|------|------|
| `logged_at` | 記録日時（サーバー時刻） |
| `actor_email` | 操作者メール（`Session.getActiveUser().getEmail()`） |
| `action` | 操作種別（例: `channel_update`, `channel_register`） |
| `channel_id` | 対象チャンネル ID（該当しない操作は空可） |
| `summary` | 変更概要（JSON 文字列や人可読の短文。長文は控える） |

- 行の更新・削除は行わず、**常に末尾に追記**する。
- 肥大化対策（アーカイブ・削除方針）は運用で別途決める（MVP では未規定でよい）。

### 4.3 `thread_queue` の運用ルール（中断再開）

認識はその通りで、以下の挙動を推奨する。

- スレッド返信が必要な親メッセージ（`reply_count > 0`）を見つけたら、`thread_queue` に `PENDING` で追加する。
- 実行中は対象行を `RUNNING` にし、`replies_next_cursor` を更新しながら進める。
- 1 つの親スレッドの読み込みが完了したら、その行は削除ではなく `DONE` に更新する（監査不要なら物理削除でも可）。
- 実行が中断した場合は `RUNNING` のまま残るため、次回実行で `lock_until` 期限切れ行を回収して再開する。
- 次回、同じチャンネルを処理するときは `thread_queue` で `channel_id` 一致かつ `PENDING/RUNNING` の行を優先して処理する。
- `DONE` 行は同一シートで保持し、`updated_at` 基準で 90 日超を定期削除する（別アーカイブシートは必須ではない）。


---

## 5. 取得中で落ちた場合の再開・重複/抜け漏れ対策

### 5.1 ロック（リース）方式

- 実行開始時に `lock_owner` と `lock_until` を設定し `status=RUNNING`。
- 次回実行時、`status=RUNNING` でも `lock_until` が過去なら**引き継いで再開**。
- 正常終了時は `lock_owner` / `lock_until` をクリアして `status=WAITING`。
- 異常終了時は `status=ERROR` か `WAITING` に戻しつつカーソルは保持（要件優先なら `WAITING` 推奨）。

### 5.2 再開ポイントを API 値で保持

- 親メッセージ: `history_oldest_ts` + `history_next_cursor`
- スレッド返信: `thread_current_parent_ts` + `replies_next_cursor`
- これにより、途中中断しても**同じ API ページの続きから再開**できる。

### 5.3 重複防止

- 保存前に `message_ts` 重複チェック（同一ファイル末尾付近 + 必要ならインデックス）。
- 境界は `oldest` 排他で運用し、同一 `ts` のリスクは最終重複チェックで吸収。
- 書き込み単位は「1 API レスポンス分をメモリで整形 -> まとめて追記」。失敗時はカーソル更新順序を固定（**先に書き込み成功、後でカーソル更新**）。

### 5.4 抜け漏れ防止

- `history_next_cursor` がある間は同じ `oldest/latest` 条件でページ継続。
- スレッドは `reply_count > 0` の親を必ず `thread_queue` へ登録。
- `thread_queue` が空で、かつ `history` 側が最新到達ならその実行分完了。

---

## 6. トリガー頻度・1回処理フロー・対象行選定ルール

### 6.1 トリガー頻度（推奨）

- 基本: **5 分ごと**（時間主導トリガー）
- backlog が多い期間: **3 分ごと**へ一時短縮（レートに余裕がある場合）
- 1 回の実行時間予算: **最大 4.5 分**（安全停止）

### 6.2 1 回分の処理フロー

1. 対象行を 1 件選定（次節の優先ルール）
2. 行ロック取得（`lock_owner`, `lock_until`, `status=RUNNING`）
3. チャンネル名を最新化し、必要なら同一 `channel_id` の全ログファイルをリネーム
4. `history` を取得（`history_next_cursor` 優先、なければ `history_oldest_ts` から）
5. 取得メッセージを整形し CSV/JSONL に追記（必要なら part を繰り上げ）
6. `reply_count > 0` を `thread_queue` に投入
7. `thread_queue` を予算内で処理（`replies_next_cursor` で再開）
8. 成功した分のカーソル (`*_ts`, `*_next_cursor`) と時刻 (`sort_last_run_at`, `last_success_at`, `live_last_message_at`) を更新
9. ロック解放して `status=WAITING`（または運用上の待機状態）
10. エラー時は `last_error_*`, `consecutive_failures` 更新し、次回再開可能なカーソルは維持
11. 実行終盤で `thread_queue` の `DONE` かつ期限超過（90日）を削除

### 6.3 対象行選定（優先順位）

実行時に `status != DISABLED` の行から以下で 1 件選ぶ。

1. `priority_interrupt_at` が入っている行を最優先（昇順）
2. 同順位は `sort_last_run_at` 昇順（古い順）
3. `sort_last_run_at` が同値/空なら `live_last_message_at` 昇順（古い順）
4. さらに同値なら `registered_at` 昇順

補足:

- `RUNNING` 行でも `lock_until` 期限切れなら選定対象に戻す。
- `ERROR` は通常対象に含める（自動復旧重視）。恒久停止したい場合のみ `DISABLED`。

---

## 7. ユーザー ID ↔ 名前キャッシュ（推奨）

`users.info` の呼び過ぎを防ぐため、`slack_user_cache` シートを持つ。


| 列名             | 内容     |
| -------------- | ------ |
| `user_id`      | 主キー    |
| `display_name` | 表示名    |
| `real_name`    | 本名     |
| `is_bot`       | bot 判定 |
| `is_deleted`   | 無効ユーザー |
| `updated_at`   | 更新日時   |


メッセージ整形時は `display_name -> real_name -> user_id` の順で採用。

---

## 8. シート作成用ヘッダー（コピペ用）

### 8.1 channel_sync_state

```csv
status,channel_id,channel_name_current,priority_interrupt_at,sort_last_run_at,live_last_message_at,sync_mode,backfill_completed_at,history_oldest_ts,history_next_cursor,history_inclusive,live_last_message_ts,thread_current_parent_ts,replies_next_cursor,thread_queue_ref,drive_csv_current_part,drive_jsonl_current_part,drive_csv_current_file_id,drive_jsonl_current_file_id,drive_last_renamed_at,lock_owner,lock_until,last_success_at,last_error_at,last_error_message,consecutive_failures,registered_at,registered_by,note,ui_last_updated_at,ui_last_updated_by
```

**既存シート移行:** すでに 29 列までしかない場合は、`note` の右隣に上記 2 列を**手動またはスクリプトで追加**し、1 行目のヘッダーを設計どおりに合わせる。同期ワーカー実行前に `validateAllSheetSchemas_` / `healthCheck` でヘッダー一致を確認する。

### 8.2 thread_queue

```csv
queue_id,channel_id,parent_thread_ts,status,replies_next_cursor,last_reply_ts_processed,lock_owner,lock_until,last_error_at,last_error_message,retry_count,updated_at,created_at
```

### 8.3 slack_user_cache

```csv
user_id,display_name,real_name,is_bot,is_deleted,updated_at
```

### 8.4 admin_ui_audit（任意）

```csv
logged_at,actor_email,action,channel_id,summary
```

---

## 9. テーブル化の是非と列型

本構成では、Google スプレッドシートのテーブル機能は**使用しない**。各シートの 1 行目をヘッダー行として固定し、GAS は `getDataRange()` / `getValues()` で処理する。

実装側では、読み込み開始時にヘッダー名一致チェックを必ず行う。

### 9.1 channel_sync_state の列型（推奨）

| 列名 | 型 |
|------|----|
| `status` | ENUM (`PENDING/RUNNING/WAITING/ERROR/DISABLED`) |
| `channel_id` | STRING |
| `channel_name_current` | STRING |
| `priority_interrupt_at` | DATETIME(nullable) |
| `sort_last_run_at` | DATETIME(nullable) |
| `live_last_message_at` | DATETIME(nullable) |
| `sync_mode` | ENUM (`BACKFILL/LIVE`) |
| `backfill_completed_at` | DATETIME(nullable) |
| `history_oldest_ts` | STRING |
| `history_next_cursor` | STRING(nullable) |
| `history_inclusive` | BOOLEAN |
| `live_last_message_ts` | STRING(nullable) |
| `thread_current_parent_ts` | STRING(nullable) |
| `replies_next_cursor` | STRING(nullable) |
| `thread_queue_ref` | STRING(nullable) |
| `drive_csv_current_part` | STRING(2桁) |
| `drive_jsonl_current_part` | STRING(2桁) |
| `drive_csv_current_file_id` | STRING(nullable) |
| `drive_jsonl_current_file_id` | STRING(nullable) |
| `drive_last_renamed_at` | DATETIME(nullable) |
| `lock_owner` | STRING(nullable) |
| `lock_until` | DATETIME(nullable) |
| `last_success_at` | DATETIME(nullable) |
| `last_error_at` | DATETIME(nullable) |
| `last_error_message` | STRING(nullable) |
| `consecutive_failures` | NUMBER(integer) |
| `registered_at` | DATETIME |
| `registered_by` | STRING |
| `note` | STRING(nullable) |
| `ui_last_updated_at` | DATETIME(nullable) |
| `ui_last_updated_by` | STRING(nullable) |

### 9.2 thread_queue の列型（推奨）

| 列名 | 型 |
|------|----|
| `queue_id` | STRING(UUID推奨) |
| `channel_id` | STRING |
| `parent_thread_ts` | STRING |
| `status` | ENUM (`PENDING/RUNNING/DONE/ERROR`) |
| `replies_next_cursor` | STRING(nullable) |
| `last_reply_ts_processed` | STRING(nullable) |
| `lock_owner` | STRING(nullable) |
| `lock_until` | DATETIME(nullable) |
| `last_error_at` | DATETIME(nullable) |
| `last_error_message` | STRING(nullable) |
| `retry_count` | NUMBER(integer) |
| `updated_at` | DATETIME |
| `created_at` | DATETIME |

### 9.3 slack_user_cache の列型（推奨）

| 列名 | 型 |
|------|----|
| `user_id` | STRING |
| `display_name` | STRING(nullable) |
| `real_name` | STRING(nullable) |
| `is_bot` | BOOLEAN |
| `is_deleted` | BOOLEAN |
| `updated_at` | DATETIME |

### 9.4 admin_ui_audit の列型（推奨）

| 列名 | 型 |
|------|-----|
| `logged_at` | DATETIME |
| `actor_email` | STRING |
| `action` | STRING |
| `channel_id` | STRING(nullable) |
| `summary` | STRING(nullable) |

---

## 10. 実装時チェックリスト

- `Config.js` に列名/列番号・`limit`・時間予算・ファイル分割閾値を定義（`channel_sync_state` は **31 列**、`ui_*` は同期ワーカーから**書き込まない**）
- 既存スプレッドシートへ **`ui_last_updated_at` / `ui_last_updated_by`** を追加したうえでヘッダー検証を通す
- 管理 Web UI 用に **`admin_ui_audit`** シートを使う場合は §8.4 のヘッダーで作成（任意）
- Script Properties に Slack Token / Spreadsheet ID / Drive Folder ID を定義
- `ts` 比較ヘルパーを実装（小数点付き文字列を安全比較）
- カーソル更新順序を固定（書き込み成功後にカーソル更新）
- 改名時の全 part リネーム処理を実装（`channel_id` 一致で抽出）

---

## 11. 参考リンク（公式）

- [conversations.history](https://api.slack.com/methods/conversations.history)
- [conversations.replies](https://api.slack.com/methods/conversations.replies)
- [Pagination](https://api.slack.com/docs/pagination)

