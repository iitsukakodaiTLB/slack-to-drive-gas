/**
 * Global configuration for slack-to-drive-gas.
 * Keep all tunable values and schema definitions here.
 */
const CONFIG = Object.freeze({
  SPREADSHEET: Object.freeze({
    ID_PROPERTY_KEY: "SPREADSHEET_ID",
    SHEETS: Object.freeze({
      CHANNEL_SYNC_STATE: "channel_sync_state",
      THREAD_QUEUE: "thread_queue",
      SLACK_USER_CACHE: "slack_user_cache",
    }),
  }),

  DRIVE: Object.freeze({
    ROOT_FOLDER_ID_PROPERTY_KEY: "DRIVE_ROOT_FOLDER_ID",
    FILE_NAMING: Object.freeze({
      PART_PADDING: 2,
      CSV_EXTENSION: ".csv",
      JSONL_EXTENSION: ".jsonl",
      // {channel_name_sanitized}__{channel_id}__{part_no}.ext
      SEPARATOR: "__",
    }),
  }),

  SLACK: Object.freeze({
    BOT_TOKEN_PROPERTY_KEY: "SLACK_BOT_TOKEN",
    API_BASE_URL: "https://slack.com/api",
    HISTORY_LIMIT_PER_REQUEST: 200,
    REPLIES_LIMIT_PER_REQUEST: 200,
    HISTORY_INCLUSIVE_DEFAULT: false,
  }),

  EXECUTION: Object.freeze({
    // 5 min trigger with safety margin
    MAX_RUNTIME_MS: 270000,
    LOCK_LEASE_MS: 360000,
    MAX_API_CALLS_PER_RUN: 120,
    MAX_THREAD_QUEUE_ITEMS_PER_RUN: 100,
    MAX_USER_INFO_LOOKUPS_PER_RUN: 50,
    MAX_CHANNEL_CONSECUTIVE_FAILURES: 10,
  }),

  FILE_SPLIT: Object.freeze({
    // Tune based on NotebookLM limits
    ENABLED: true,
    MAX_BYTES_PER_FILE: 40 * 1024 * 1024,
  }),

  THREAD_QUEUE: Object.freeze({
    DONE_RETENTION_DAYS: 90,
    MAX_RETRY_COUNT: 5,
    ERROR_RETRY_BASE_MINUTES: 5,
    ERROR_RETRY_MAX_MINUTES: 180,
    // Safety-first rollout: keep disabled until explicitly enabled.
    ENABLE_RECENT_THREAD_SEED: false,
    RECENT_THREAD_SEED_WINDOW_DAYS: 7,
    RECENT_THREAD_SEED_MAX_HISTORY_CALLS_PER_RUN: 3,
    ENABLE_DONE_THREAD_RECHECK: false,
    DONE_THREAD_RECHECK_PER_RUN: 20,
    DONE_THREAD_RECHECK_MIN_INTERVAL_HOURS: 24,
  }),
});

const STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
});

const SYNC_MODE = Object.freeze({
  BACKFILL: "BACKFILL",
  LIVE: "LIVE",
});

const THREAD_QUEUE_STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  DONE: "DONE",
  ERROR: "ERROR",
});

/**
 * Header definitions (row 1).
 * Keep these arrays aligned with the spreadsheet setup.
 */
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

  THREAD_QUEUE: Object.freeze([
    "queue_id",
    "channel_id",
    "parent_thread_ts",
    "status",
    "replies_next_cursor",
    "last_reply_ts_processed",
    "lock_owner",
    "lock_until",
    "last_error_at",
    "last_error_message",
    "retry_count",
    "updated_at",
    "created_at",
  ]),

  SLACK_USER_CACHE: Object.freeze([
    "user_id",
    "display_name",
    "real_name",
    "is_bot",
    "is_deleted",
    "updated_at",
  ]),
});

/**
 * 1-based column indexes for SpreadsheetApp.getRange(row, col).
 */
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
    /** 管理 Web UI のみ更新。同期ワーカーは書き込まない。 */
    UI_LAST_UPDATED_AT: 30,
    UI_LAST_UPDATED_BY: 31,
  }),

  THREAD_QUEUE: Object.freeze({
    QUEUE_ID: 1,
    CHANNEL_ID: 2,
    PARENT_THREAD_TS: 3,
    STATUS: 4,
    REPLIES_NEXT_CURSOR: 5,
    LAST_REPLY_TS_PROCESSED: 6,
    LOCK_OWNER: 7,
    LOCK_UNTIL: 8,
    LAST_ERROR_AT: 9,
    LAST_ERROR_MESSAGE: 10,
    RETRY_COUNT: 11,
    UPDATED_AT: 12,
    CREATED_AT: 13,
  }),

  SLACK_USER_CACHE: Object.freeze({
    USER_ID: 1,
    DISPLAY_NAME: 2,
    REAL_NAME: 3,
    IS_BOT: 4,
    IS_DELETED: 5,
    UPDATED_AT: 6,
  }),
});
