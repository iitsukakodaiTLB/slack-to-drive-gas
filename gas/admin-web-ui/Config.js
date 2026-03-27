/**
 * Admin Web UI — 設定スキーマ（同期ワーカー Config.js と channel_sync_state 列を一致させる）
 */
const CONFIG = Object.freeze({
  SPREADSHEET: Object.freeze({
    ID_PROPERTY_KEY: "SPREADSHEET_ID",
    SHEETS: Object.freeze({
      CHANNEL_SYNC_STATE: "channel_sync_state",
      ADMIN_UI_AUDIT: "admin_ui_audit",
    }),
  }),

  SLACK: Object.freeze({
    BOT_TOKEN_PROPERTY_KEY: "SLACK_BOT_TOKEN",
    API_BASE_URL: "https://slack.com/api",
  }),

  /** 一覧 API の 1 回あたり最大行数（ヘッダー除く） */
  LIST_PAGE_SIZE: 200,
});

const STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
});

const SHEET_HEADERS = Object.freeze({
  CHANNEL_SYNC_STATE: Object.freeze([
    "status",
    "channel_id",
    "channel_name_current",
    "priority_interrupt_at",
    "sort_last_run_at",
    "live_last_message_at",
    "sync_mode",
    "backfill_completed_at",
    "history_oldest_ts",
    "history_next_cursor",
    "history_inclusive",
    "live_last_message_ts",
    "thread_current_parent_ts",
    "replies_next_cursor",
    "thread_queue_ref",
    "drive_csv_current_part",
    "drive_jsonl_current_part",
    "drive_csv_current_file_id",
    "drive_jsonl_current_file_id",
    "drive_last_renamed_at",
    "lock_owner",
    "lock_until",
    "last_success_at",
    "last_error_at",
    "last_error_message",
    "consecutive_failures",
    "registered_at",
    "registered_by",
    "note",
    "ui_last_updated_at",
    "ui_last_updated_by",
  ]),

  ADMIN_UI_AUDIT: Object.freeze([
    "logged_at",
    "actor_email",
    "action",
    "channel_id",
    "summary",
  ]),
});

const COLS = Object.freeze({
  CHANNEL_SYNC_STATE: Object.freeze({
    STATUS: 1,
    CHANNEL_ID: 2,
    CHANNEL_NAME_CURRENT: 3,
    PRIORITY_INTERRUPT_AT: 4,
    SORT_LAST_RUN_AT: 5,
    LIVE_LAST_MESSAGE_AT: 6,
    SYNC_MODE: 7,
    BACKFILL_COMPLETED_AT: 8,
    HISTORY_OLDEST_TS: 9,
    HISTORY_NEXT_CURSOR: 10,
    HISTORY_INCLUSIVE: 11,
    LIVE_LAST_MESSAGE_TS: 12,
    THREAD_CURRENT_PARENT_TS: 13,
    REPLIES_NEXT_CURSOR: 14,
    THREAD_QUEUE_REF: 15,
    DRIVE_CSV_CURRENT_PART: 16,
    DRIVE_JSONL_CURRENT_PART: 17,
    DRIVE_CSV_CURRENT_FILE_ID: 18,
    DRIVE_JSONL_CURRENT_FILE_ID: 19,
    DRIVE_LAST_RENAMED_AT: 20,
    LOCK_OWNER: 21,
    LOCK_UNTIL: 22,
    LAST_SUCCESS_AT: 23,
    LAST_ERROR_AT: 24,
    LAST_ERROR_MESSAGE: 25,
    CONSECUTIVE_FAILURES: 26,
    REGISTERED_AT: 27,
    REGISTERED_BY: 28,
    NOTE: 29,
    UI_LAST_UPDATED_AT: 30,
    UI_LAST_UPDATED_BY: 31,
  }),
});
