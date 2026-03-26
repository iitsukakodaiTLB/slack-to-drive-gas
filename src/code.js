/**
 * Main scheduled entrypoint.
 * Current scope:
 * - validate environment/schemas
 * - pick one target row by priority
 * - acquire/release lease lock safely
 */
function runSlackLogSync() {
  validateRequiredScriptProperties_();
  const ss = getSettingsSpreadsheet_();
  validateAllSheetSchemas_(ss);
  const channelSheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE);

  const docLock = LockService.getDocumentLock();
  docLock.waitLock(30000);
  let target = null;
  let runId = null;
  try {
    target = selectNextChannelRow_(channelSheet, new Date());
    if (!target) {
      Logger.log("runSlackLogSync: no target row.");
      return;
    }

    runId = Utilities.getUuid();
    acquireLeaseForRow_(channelSheet, target.rowIndex, runId, new Date());
  } finally {
    docLock.releaseLock();
  }

  if (!target || !runId) {
    return;
  }

  const startedAt = new Date();
  try {
    executeSyncForChannel_(ss, channelSheet, target, runId, startedAt);
    markRowSuccess_(channelSheet, target.rowIndex, new Date());
  } catch (error) {
    markRowFailure_(channelSheet, target.rowIndex, error);
    throw error;
  } finally {
    releaseLeaseForRow_(channelSheet, target.rowIndex, runId);
  }
}

/**
 * One-time helper:
 * creates missing sheets and writes header row if empty.
 */
function bootstrapSheets() {
  validateRequiredScriptProperties_();
  const ss = getSettingsSpreadsheet_();
  ensureSheetWithHeader_(ss, CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE, SHEET_HEADERS.CHANNEL_SYNC_STATE);
  ensureSheetWithHeader_(ss, CONFIG.SPREADSHEET.SHEETS.THREAD_QUEUE, SHEET_HEADERS.THREAD_QUEUE);
  ensureSheetWithHeader_(ss, CONFIG.SPREADSHEET.SHEETS.SLACK_USER_CACHE, SHEET_HEADERS.SLACK_USER_CACHE);
}

/**
 * Prints a quick health report into execution logs.
 */
function healthCheck() {
  validateRequiredScriptProperties_();
  const ss = getSettingsSpreadsheet_();
  validateAllSheetSchemas_(ss);
  Logger.log("healthCheck: OK");
}

/**
 * Creates a 5-minute time-based trigger for runSlackLogSync.
 * Existing triggers for the same handler are removed first.
 */
function setupFiveMinuteTrigger() {
  deleteTriggersByHandler_("runSlackLogSync");
  ScriptApp.newTrigger("runSlackLogSync").timeBased().everyMinutes(5).create();
  Logger.log("setupFiveMinuteTrigger: created");
}

/**
 * Deletes all time-driven triggers bound to runSlackLogSync.
 */
function deleteRunSlackLogSyncTriggers() {
  deleteTriggersByHandler_("runSlackLogSync");
  Logger.log("deleteRunSlackLogSyncTriggers: deleted");
}

/**
 * Manual recovery utility.
 * Use when a channel was disabled after repeated failures.
 */
function resumeChannel(channelId) {
  validateRequiredScriptProperties_();
  const id = toStringSafe_(channelId);
  if (!id) {
    throw new Error("resumeChannel: channelId is required");
  }

  const ss = getSettingsSpreadsheet_();
  validateAllSheetSchemas_(ss);
  const sheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE);
  const match = findSingleChannelRowById_(sheet, id);
  const c = COLS.CHANNEL_SYNC_STATE;
  const now = new Date();

  sheet.getRange(match.rowIndex, c.STATUS).setValue(STATUS.WAITING);
  sheet.getRange(match.rowIndex, c.CONSECUTIVE_FAILURES).setValue(0);
  sheet.getRange(match.rowIndex, c.LAST_ERROR_AT).clearContent();
  sheet.getRange(match.rowIndex, c.LAST_ERROR_MESSAGE).clearContent();
  sheet.getRange(match.rowIndex, c.LOCK_OWNER).clearContent();
  sheet.getRange(match.rowIndex, c.LOCK_UNTIL).clearContent();
  sheet.getRange(match.rowIndex, c.SORT_LAST_RUN_AT).setValue(now);

  const prevNote = toStringSafe_(sheet.getRange(match.rowIndex, c.NOTE).getValue());
  const event = "[manual_resume] " + now.toISOString();
  const nextNote = prevNote ? truncateForCell_(prevNote + " | " + event, 4000) : event;
  sheet.getRange(match.rowIndex, c.NOTE).setValue(nextNote);

  Logger.log("resumeChannel: resumed channel_id=%s row=%s", id, match.rowIndex);
}

/**
 * Manual disable utility.
 * Optional operational helper to stop a channel intentionally.
 */
function disableChannel(channelId, reason) {
  validateRequiredScriptProperties_();
  const id = toStringSafe_(channelId);
  if (!id) {
    throw new Error("disableChannel: channelId is required");
  }

  const ss = getSettingsSpreadsheet_();
  validateAllSheetSchemas_(ss);
  const sheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE);
  const match = findSingleChannelRowById_(sheet, id);
  const c = COLS.CHANNEL_SYNC_STATE;
  const now = new Date();

  sheet.getRange(match.rowIndex, c.STATUS).setValue(STATUS.DISABLED);
  sheet.getRange(match.rowIndex, c.LOCK_OWNER).clearContent();
  sheet.getRange(match.rowIndex, c.LOCK_UNTIL).clearContent();
  sheet.getRange(match.rowIndex, c.SORT_LAST_RUN_AT).setValue(now);

  const reasonText = toStringSafe_(reason) || "manual";
  const prevNote = toStringSafe_(sheet.getRange(match.rowIndex, c.NOTE).getValue());
  const event = "[manual_disable] " + now.toISOString() + " reason=" + reasonText;
  const nextNote = prevNote ? truncateForCell_(prevNote + " | " + event, 4000) : event;
  sheet.getRange(match.rowIndex, c.NOTE).setValue(nextNote);

  Logger.log("disableChannel: disabled channel_id=%s row=%s reason=%s", id, match.rowIndex, reasonText);
}

function validateRequiredScriptProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const required = [
    CONFIG.SLACK.BOT_TOKEN_PROPERTY_KEY,
    CONFIG.SPREADSHEET.ID_PROPERTY_KEY,
    CONFIG.DRIVE.ROOT_FOLDER_ID_PROPERTY_KEY,
  ];

  const missing = required.filter((key) => !properties.getProperty(key));
  if (missing.length > 0) {
    throw new Error("Missing Script Properties: " + missing.join(", "));
  }
}

function getSettingsSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SPREADSHEET.ID_PROPERTY_KEY
  );
  return SpreadsheetApp.openById(spreadsheetId);
}

function validateAllSheetSchemas_(ss) {
  validateSheetHeader_(
    ss,
    CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE,
    SHEET_HEADERS.CHANNEL_SYNC_STATE
  );
  validateSheetHeader_(
    ss,
    CONFIG.SPREADSHEET.SHEETS.THREAD_QUEUE,
    SHEET_HEADERS.THREAD_QUEUE
  );
  validateSheetHeader_(
    ss,
    CONFIG.SPREADSHEET.SHEETS.SLACK_USER_CACHE,
    SHEET_HEADERS.SLACK_USER_CACHE
  );
}

function ensureSheetWithHeader_(ss, sheetName, expectedHeaders) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const lastCol = sheet.getLastColumn();
  const hasAnyData = sheet.getLastRow() > 0 || lastCol > 0;
  if (!hasAnyData) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return;
  }

  validateSheetHeader_(ss, sheetName, expectedHeaders);
}

function validateSheetHeader_(ss, sheetName, expectedHeaders) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }

  const actualHeaders = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0]
    .map((value) => String(value).trim());

  const mismatches = [];
  for (let i = 0; i < expectedHeaders.length; i += 1) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      mismatches.push(
        "col " +
          (i + 1) +
          ': expected "' +
          expectedHeaders[i] +
          '" but got "' +
          actualHeaders[i] +
          '"'
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      'Header mismatch in sheet "' + sheetName + '": ' + mismatches.join("; ")
    );
  }
}

function findSingleChannelRowById_(sheet, channelId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    throw new Error("findSingleChannelRowById: no data rows");
  }
  const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const matches = [];
  for (let i = 0; i < values.length; i += 1) {
    const rowIndex = i + 2;
    const id = toStringSafe_(values[i][COLS.CHANNEL_SYNC_STATE.CHANNEL_ID - 1]);
    if (id === channelId) {
      matches.push({ rowIndex: rowIndex });
    }
  }

  if (matches.length === 0) {
    throw new Error("channel_id not found: " + channelId);
  }
  if (matches.length > 1) {
    throw new Error("duplicate channel_id rows found: " + channelId);
  }
  return matches[0];
}

function selectNextChannelRow_(sheet, now) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const candidates = [];

  for (let i = 0; i < values.length; i += 1) {
    const rowIndex = i + 2;
    const row = values[i];
    const model = toChannelRowModel_(rowIndex, row);
    if (isChannelRowEligible_(model, now)) {
      candidates.push(model);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(compareChannelPriority_);
  return candidates[0];
}

function toChannelRowModel_(rowIndex, row) {
  const c = COLS.CHANNEL_SYNC_STATE;
  return {
    rowIndex: rowIndex,
    status: toStringSafe_(row[c.STATUS - 1]),
    channelId: toStringSafe_(row[c.CHANNEL_ID - 1]),
    priorityInterruptAt: toDateOrNull_(row[c.PRIORITY_INTERRUPT_AT - 1]),
    sortLastRunAt: toDateOrNull_(row[c.SORT_LAST_RUN_AT - 1]),
    liveLastMessageAt: toDateOrNull_(row[c.LIVE_LAST_MESSAGE_AT - 1]),
    lockUntil: toDateOrNull_(row[c.LOCK_UNTIL - 1]),
    lockOwner: toStringSafe_(row[c.LOCK_OWNER - 1]),
  };
}

function isChannelRowEligible_(row, now) {
  if (!row.channelId) {
    return false;
  }
  if (row.status === STATUS.DISABLED) {
    return false;
  }

  if (row.status === STATUS.RUNNING) {
    if (!row.lockUntil) {
      return false;
    }
    return row.lockUntil.getTime() <= now.getTime();
  }

  return (
    row.status === STATUS.PENDING ||
    row.status === STATUS.WAITING ||
    row.status === STATUS.ERROR ||
    row.status === ""
  );
}

function compareChannelPriority_(a, b) {
  const aHasInterrupt = !!a.priorityInterruptAt;
  const bHasInterrupt = !!b.priorityInterruptAt;
  if (aHasInterrupt !== bHasInterrupt) {
    return aHasInterrupt ? -1 : 1;
  }
  if (aHasInterrupt && bHasInterrupt) {
    const interruptDiff = compareDateNullableAsc_(a.priorityInterruptAt, b.priorityInterruptAt);
    if (interruptDiff !== 0) {
      return interruptDiff;
    }
  }

  const runDiff = compareDateNullableAsc_(a.sortLastRunAt, b.sortLastRunAt);
  if (runDiff !== 0) {
    return runDiff;
  }

  const liveDiff = compareDateNullableAsc_(a.liveLastMessageAt, b.liveLastMessageAt);
  if (liveDiff !== 0) {
    return liveDiff;
  }

  return a.rowIndex - b.rowIndex;
}

function compareDateNullableAsc_(a, b) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  return a.getTime() - b.getTime();
}

function acquireLeaseForRow_(sheet, rowIndex, runId, now) {
  const leaseUntil = new Date(now.getTime() + CONFIG.EXECUTION.LOCK_LEASE_MS);
  const c = COLS.CHANNEL_SYNC_STATE;

  sheet.getRange(rowIndex, c.STATUS).setValue(STATUS.RUNNING);
  sheet.getRange(rowIndex, c.LOCK_OWNER).setValue(runId);
  sheet.getRange(rowIndex, c.LOCK_UNTIL).setValue(leaseUntil);
  sheet.getRange(rowIndex, c.SORT_LAST_RUN_AT).setValue(now);
}

function releaseLeaseForRow_(sheet, rowIndex, runId) {
  const c = COLS.CHANNEL_SYNC_STATE;
  const currentOwner = toStringSafe_(sheet.getRange(rowIndex, c.LOCK_OWNER).getValue());
  if (currentOwner !== runId) {
    // Another run already took ownership (stale release attempt).
    return;
  }

  sheet.getRange(rowIndex, c.LOCK_OWNER).clearContent();
  sheet.getRange(rowIndex, c.LOCK_UNTIL).clearContent();
}

function markRowRunHeartbeat_(sheet, rowIndex, now) {
  const c = COLS.CHANNEL_SYNC_STATE;
  sheet.getRange(rowIndex, c.SORT_LAST_RUN_AT).setValue(now);
}

function markRowSuccess_(sheet, rowIndex, now) {
  const c = COLS.CHANNEL_SYNC_STATE;
  sheet.getRange(rowIndex, c.STATUS).setValue(STATUS.WAITING);
  sheet.getRange(rowIndex, c.LAST_SUCCESS_AT).setValue(now);
  sheet.getRange(rowIndex, c.LAST_ERROR_AT).clearContent();
  sheet.getRange(rowIndex, c.LAST_ERROR_MESSAGE).clearContent();
  sheet.getRange(rowIndex, c.CONSECUTIVE_FAILURES).setValue(0);
}

function markRowFailure_(sheet, rowIndex, error) {
  const c = COLS.CHANNEL_SYNC_STATE;
  const now = new Date();
  const currentFailures = Number(sheet.getRange(rowIndex, c.CONSECUTIVE_FAILURES).getValue() || 0);
  const nextFailures = currentFailures + 1;
  const shouldDisable = nextFailures >= CONFIG.EXECUTION.MAX_CHANNEL_CONSECUTIVE_FAILURES;

  sheet.getRange(rowIndex, c.STATUS).setValue(shouldDisable ? STATUS.DISABLED : STATUS.ERROR);
  sheet.getRange(rowIndex, c.LAST_ERROR_AT).setValue(now);
  const baseMessage = truncateForCell_(String(error), 3800);
  const finalMessage = shouldDisable
    ? "[channel_disabled_after_consecutive_failures] " + baseMessage
    : baseMessage;
  sheet.getRange(rowIndex, c.LAST_ERROR_MESSAGE).setValue(truncateForCell_(finalMessage, 4000));
  sheet.getRange(rowIndex, c.CONSECUTIVE_FAILURES).setValue(nextFailures);
}

function toDateOrNull_(value) {
  if (!value) {
    return null;
  }
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function toStringSafe_(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function truncateForCell_(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

function executeSyncForChannel_(ss, channelSheet, target, runId, startedAt) {
  const deadlineMs = startedAt.getTime() + CONFIG.EXECUTION.MAX_RUNTIME_MS;
  const threadSheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.THREAD_QUEUE);
  const userResolver = buildUserNameResolver_(ss, CONFIG.EXECUTION.MAX_USER_INFO_LOOKUPS_PER_RUN);

  let apiCalls = 0;
  const channelSnapshot = readChannelRowSnapshot_(channelSheet, target.rowIndex);
  const channelId = channelSnapshot.channelId;
  if (!channelId) {
    throw new Error("channel_id is empty");
  }

  const channelName = fetchAndSyncChannelName_(channelSheet, target.rowIndex, channelId, channelSnapshot.channelNameCurrent);
  const fileCtx = ensureCurrentLogFiles_(channelSheet, target.rowIndex, channelId, channelName);
  ensureChannelSyncModeInitialized_(channelSheet, target.rowIndex, channelSnapshot.syncMode);

  // 1) Process queued thread replies first for resumability.
  apiCalls += processThreadQueueForChannel_(
    threadSheet,
    channelSheet,
    target.rowIndex,
    runId,
    channelId,
    fileCtx,
    userResolver,
    deadlineMs,
    apiCalls
  );

  // 2) Pull one or more history pages within budget.
  while (Date.now() < deadlineMs - 3000 && apiCalls < CONFIG.EXECUTION.MAX_API_CALLS_PER_RUN) {
    const snap = readChannelRowSnapshot_(channelSheet, target.rowIndex);
    const isBackfill = snap.syncMode === SYNC_MODE.BACKFILL;
    const history = slackConversationsHistory_({
      channel: channelId,
      oldest: isBackfill ? undefined : snap.historyOldestTs || undefined,
      cursor: snap.historyNextCursor || undefined,
      inclusive: snap.historyInclusive,
      limit: CONFIG.SLACK.HISTORY_LIMIT_PER_REQUEST,
    });
    apiCalls += 1;

    const messages = (history.messages || []).slice().reverse();
    if (messages.length > 0) {
      appendMessagesToLogs_(fileCtx, channelId, messages, userResolver);
      enqueueThreadParents_(threadSheet, channelId, messages);

      const maxTs = getMaxTsFromMessages_(messages);
      if (maxTs) {
        channelSheet.getRange(target.rowIndex, COLS.CHANNEL_SYNC_STATE.LIVE_LAST_MESSAGE_TS).setValue(maxTs);
        channelSheet.getRange(target.rowIndex, COLS.CHANNEL_SYNC_STATE.LIVE_LAST_MESSAGE_AT).setValue(
          new Date(Number(maxTs) * 1000)
        );
        if (!isBackfill) {
          channelSheet.getRange(target.rowIndex, COLS.CHANNEL_SYNC_STATE.HISTORY_OLDEST_TS).setValue(maxTs);
        }
      }
    }

    const nextCursor = toStringSafe_(
      history.response_metadata && history.response_metadata.next_cursor
    );
    channelSheet.getRange(target.rowIndex, COLS.CHANNEL_SYNC_STATE.HISTORY_NEXT_CURSOR).setValue(nextCursor);

    markRowRunHeartbeat_(channelSheet, target.rowIndex, new Date());
    if (!nextCursor) {
      finalizeBackfillIfReady_(threadSheet, channelSheet, target.rowIndex, channelId);
      break;
    }
  }

  // Keep thread_queue size manageable without archive sheet.
  purgeExpiredDoneThreadQueue_(threadSheet, CONFIG.THREAD_QUEUE.DONE_RETENTION_DAYS);
}

function readChannelRowSnapshot_(sheet, rowIndex) {
  const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
  const row = sheet.getRange(rowIndex, 1, 1, width).getValues()[0];
  const c = COLS.CHANNEL_SYNC_STATE;
  return {
    channelId: toStringSafe_(row[c.CHANNEL_ID - 1]),
    channelNameCurrent: toStringSafe_(row[c.CHANNEL_NAME_CURRENT - 1]),
    syncMode: toStringSafe_(row[c.SYNC_MODE - 1]),
    historyOldestTs: toStringSafe_(row[c.HISTORY_OLDEST_TS - 1]),
    historyNextCursor: toStringSafe_(row[c.HISTORY_NEXT_CURSOR - 1]),
    historyInclusive: normalizeBoolean_(row[c.HISTORY_INCLUSIVE - 1], CONFIG.SLACK.HISTORY_INCLUSIVE_DEFAULT),
  };
}

function ensureChannelSyncModeInitialized_(channelSheet, rowIndex, syncMode) {
  if (syncMode) {
    return;
  }
  channelSheet.getRange(rowIndex, COLS.CHANNEL_SYNC_STATE.SYNC_MODE).setValue(SYNC_MODE.BACKFILL);
}

function finalizeBackfillIfReady_(threadSheet, channelSheet, rowIndex, channelId) {
  const snap = readChannelRowSnapshot_(channelSheet, rowIndex);
  if (snap.syncMode !== SYNC_MODE.BACKFILL) {
    return;
  }
  const hasPendingThreads = hasIncompleteThreadQueueForChannel_(threadSheet, channelId);
  if (hasPendingThreads) {
    return;
  }

  const now = new Date();
  const c = COLS.CHANNEL_SYNC_STATE;
  channelSheet.getRange(rowIndex, c.SYNC_MODE).setValue(SYNC_MODE.LIVE);
  channelSheet.getRange(rowIndex, c.BACKFILL_COMPLETED_AT).setValue(now);
  channelSheet.getRange(rowIndex, c.HISTORY_NEXT_CURSOR).clearContent();
  const liveLastTs = toStringSafe_(channelSheet.getRange(rowIndex, c.LIVE_LAST_MESSAGE_TS).getValue());
  if (liveLastTs) {
    channelSheet.getRange(rowIndex, c.HISTORY_OLDEST_TS).setValue(liveLastTs);
  }
}

function hasIncompleteThreadQueueForChannel_(threadSheet, channelId) {
  const lastRow = threadSheet.getLastRow();
  if (lastRow <= 1) {
    return false;
  }
  const values = threadSheet
    .getRange(2, 1, lastRow - 1, SHEET_HEADERS.THREAD_QUEUE.length)
    .getValues();
  for (let i = 0; i < values.length; i += 1) {
    const rowChannelId = toStringSafe_(values[i][COLS.THREAD_QUEUE.CHANNEL_ID - 1]);
    if (rowChannelId !== channelId) {
      continue;
    }
    const status = toStringSafe_(values[i][COLS.THREAD_QUEUE.STATUS - 1]);
    if (
      status === THREAD_QUEUE_STATUS.PENDING ||
      status === THREAD_QUEUE_STATUS.RUNNING ||
      status === THREAD_QUEUE_STATUS.ERROR
    ) {
      return true;
    }
  }
  return false;
}

function processThreadQueueForChannel_(
  threadSheet,
  channelSheet,
  channelRowIndex,
  runId,
  channelId,
  fileCtx,
  userResolver,
  deadlineMs,
  apiCalls
) {
  const queueItems = listThreadQueueItemsForChannel_(threadSheet, channelId);
  let callsUsed = 0;
  for (let i = 0; i < queueItems.length; i += 1) {
    if (Date.now() >= deadlineMs - 3000) {
      break;
    }
    if (apiCalls + callsUsed >= CONFIG.EXECUTION.MAX_API_CALLS_PER_RUN) {
      break;
    }
    if (i >= CONFIG.EXECUTION.MAX_THREAD_QUEUE_ITEMS_PER_RUN) {
      break;
    }

    const item = queueItems[i];
    lockThreadQueueItem_(threadSheet, item.rowIndex, runId);
    try {
      const res = slackConversationsReplies_({
        channel: channelId,
        ts: item.parentThreadTs,
        cursor: item.repliesNextCursor || undefined,
        limit: CONFIG.SLACK.REPLIES_LIMIT_PER_REQUEST,
      });
      callsUsed += 1;

      const replies = (res.messages || []).filter((m) => toStringSafe_(m.ts) !== item.parentThreadTs);
      if (replies.length > 0) {
        appendMessagesToLogs_(fileCtx, channelId, replies, userResolver);
        const maxTs = getMaxTsFromMessages_(replies);
        if (maxTs) {
          threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_REPLY_TS_PROCESSED).setValue(maxTs);
        }
      }

      const nextCursor = toStringSafe_(res.response_metadata && res.response_metadata.next_cursor);
      if (nextCursor) {
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.REPLIES_NEXT_CURSOR).setValue(nextCursor);
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.STATUS).setValue(THREAD_QUEUE_STATUS.RUNNING);
      } else {
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.STATUS).setValue(THREAD_QUEUE_STATUS.DONE);
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.REPLIES_NEXT_CURSOR).clearContent();
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.RETRY_COUNT).setValue(0);
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_AT).clearContent();
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_MESSAGE).clearContent();
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LOCK_OWNER).clearContent();
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LOCK_UNTIL).clearContent();
      }
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.UPDATED_AT).setValue(new Date());
      channelSheet.getRange(channelRowIndex, COLS.CHANNEL_SYNC_STATE.THREAD_CURRENT_PARENT_TS).setValue(
        item.parentThreadTs
      );
    } catch (error) {
      const currentRetry = Number(
        threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.RETRY_COUNT).getValue() || 0
      );
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.STATUS).setValue(THREAD_QUEUE_STATUS.ERROR);
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_AT).setValue(new Date());
      threadSheet
        .getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_MESSAGE)
        .setValue(truncateForCell_(String(error), 4000));
      const nextRetry = currentRetry + 1;
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.RETRY_COUNT).setValue(nextRetry);
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.UPDATED_AT).setValue(new Date());
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LOCK_OWNER).clearContent();
      threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LOCK_UNTIL).clearContent();

      if (nextRetry >= CONFIG.THREAD_QUEUE.MAX_RETRY_COUNT) {
        const currentMessage = toStringSafe_(
          threadSheet.getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_MESSAGE).getValue()
        );
        threadSheet
          .getRange(item.rowIndex, COLS.THREAD_QUEUE.LAST_ERROR_MESSAGE)
          .setValue(
            truncateForCell_(
              "[retry_exhausted] " + currentMessage,
              4000
            )
          );
      }
    }
  }
  return callsUsed;
}

function listThreadQueueItemsForChannel_(sheet, channelId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  const width = SHEET_HEADERS.THREAD_QUEUE.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const now = new Date();
  const items = [];
  for (let i = 0; i < values.length; i += 1) {
    const row = values[i];
    const rowIndex = i + 2;
    const status = toStringSafe_(row[COLS.THREAD_QUEUE.STATUS - 1]);
    const rowChannelId = toStringSafe_(row[COLS.THREAD_QUEUE.CHANNEL_ID - 1]);
    if (rowChannelId !== channelId) {
      continue;
    }
    if (
      status !== THREAD_QUEUE_STATUS.PENDING &&
      status !== THREAD_QUEUE_STATUS.RUNNING &&
      status !== THREAD_QUEUE_STATUS.ERROR
    ) {
      continue;
    }
    const lockUntil = toDateOrNull_(row[COLS.THREAD_QUEUE.LOCK_UNTIL - 1]);
    if (status === THREAD_QUEUE_STATUS.RUNNING && lockUntil && lockUntil.getTime() > now.getTime()) {
      continue;
    }
    const retryCount = Number(row[COLS.THREAD_QUEUE.RETRY_COUNT - 1] || 0);
    const updatedAt = toDateOrNull_(row[COLS.THREAD_QUEUE.UPDATED_AT - 1]);
    if (status === THREAD_QUEUE_STATUS.ERROR) {
      if (retryCount >= CONFIG.THREAD_QUEUE.MAX_RETRY_COUNT) {
        continue;
      }
      if (!shouldRetryErrorThreadQueueItemNow_(retryCount, updatedAt, now)) {
        continue;
      }
    }
    items.push({
      rowIndex: rowIndex,
      parentThreadTs: toStringSafe_(row[COLS.THREAD_QUEUE.PARENT_THREAD_TS - 1]),
      repliesNextCursor: toStringSafe_(row[COLS.THREAD_QUEUE.REPLIES_NEXT_CURSOR - 1]),
      status: status,
      updatedAt: updatedAt,
    });
  }

  items.sort(function (a, b) {
    return compareDateNullableAsc_(a.updatedAt, b.updatedAt);
  });
  return items;
}

function lockThreadQueueItem_(sheet, rowIndex, runId) {
  const leaseUntil = new Date(Date.now() + CONFIG.EXECUTION.LOCK_LEASE_MS);
  sheet.getRange(rowIndex, COLS.THREAD_QUEUE.STATUS).setValue(THREAD_QUEUE_STATUS.RUNNING);
  sheet.getRange(rowIndex, COLS.THREAD_QUEUE.LOCK_OWNER).setValue(runId);
  sheet.getRange(rowIndex, COLS.THREAD_QUEUE.LOCK_UNTIL).setValue(leaseUntil);
  sheet.getRange(rowIndex, COLS.THREAD_QUEUE.UPDATED_AT).setValue(new Date());
}

function enqueueThreadParents_(threadSheet, channelId, messages) {
  const targets = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (Number(m.reply_count || 0) > 0 && m.thread_ts) {
      targets.push(toStringSafe_(m.thread_ts));
    }
  }
  if (targets.length === 0) {
    return;
  }
  const uniqueTargets = dedupeStrings_(targets);
  const existing = new Set(getExistingThreadQueueKeys_(threadSheet, channelId));
  const now = new Date();
  const rows = [];
  for (let i = 0; i < uniqueTargets.length; i += 1) {
    const threadTs = uniqueTargets[i];
    const key = channelId + "::" + threadTs;
    if (existing.has(key)) {
      continue;
    }
    rows.push([
      Utilities.getUuid(),
      channelId,
      threadTs,
      THREAD_QUEUE_STATUS.PENDING,
      "",
      "",
      "",
      "",
      "",
      "",
      0,
      now,
      now,
    ]);
  }
  if (rows.length > 0) {
    threadSheet.getRange(threadSheet.getLastRow() + 1, 1, rows.length, SHEET_HEADERS.THREAD_QUEUE.length).setValues(rows);
  }
}

function getExistingThreadQueueKeys_(threadSheet, channelId) {
  const lastRow = threadSheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  const values = threadSheet
    .getRange(2, 1, lastRow - 1, SHEET_HEADERS.THREAD_QUEUE.length)
    .getValues();
  const keys = [];
  for (let i = 0; i < values.length; i += 1) {
    const rowChannel = toStringSafe_(values[i][COLS.THREAD_QUEUE.CHANNEL_ID - 1]);
    const threadTs = toStringSafe_(values[i][COLS.THREAD_QUEUE.PARENT_THREAD_TS - 1]);
    if (rowChannel === channelId && threadTs) {
      keys.push(channelId + "::" + threadTs);
    }
  }
  return keys;
}

function fetchAndSyncChannelName_(channelSheet, rowIndex, channelId, fallbackName) {
  const info = slackConversationsInfo_(channelId);
  const latestName = toStringSafe_(
    info.channel && (info.channel.name_normalized || info.channel.name)
  );
  const finalName = latestName || fallbackName || channelId;
  channelSheet.getRange(rowIndex, COLS.CHANNEL_SYNC_STATE.CHANNEL_NAME_CURRENT).setValue(finalName);
  return finalName;
}

function ensureCurrentLogFiles_(channelSheet, rowIndex, channelId, channelName) {
  const rootFolderId = PropertiesService.getScriptProperties().getProperty(
    CONFIG.DRIVE.ROOT_FOLDER_ID_PROPERTY_KEY
  );
  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const c = COLS.CHANNEL_SYNC_STATE;
  renameAllChannelLogFiles_(rootFolder, channelId, channelName);
  let part = toStringSafe_(channelSheet.getRange(rowIndex, c.DRIVE_CSV_CURRENT_PART).getValue());
  if (!part) {
    part = detectLatestPartForChannel_(rootFolder, channelId) || leftPadNumber_(1, CONFIG.DRIVE.FILE_NAMING.PART_PADDING);
  }

  let csvFile = resolveFileByIdOrName_(
    toStringSafe_(channelSheet.getRange(rowIndex, c.DRIVE_CSV_CURRENT_FILE_ID).getValue()),
    rootFolder,
    buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.CSV_EXTENSION)
  );
  let jsonlFile = resolveFileByIdOrName_(
    toStringSafe_(channelSheet.getRange(rowIndex, c.DRIVE_JSONL_CURRENT_FILE_ID).getValue()),
    rootFolder,
    buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.JSONL_EXTENSION)
  );

  // Rotation by size threshold.
  if (
    CONFIG.FILE_SPLIT.ENABLED &&
    (csvFile.getSize() >= CONFIG.FILE_SPLIT.MAX_BYTES_PER_FILE ||
      jsonlFile.getSize() >= CONFIG.FILE_SPLIT.MAX_BYTES_PER_FILE)
  ) {
    part = leftPadNumber_(Number(part) + 1, CONFIG.DRIVE.FILE_NAMING.PART_PADDING);
    csvFile = createEmptyFile_(rootFolder, buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.CSV_EXTENSION));
    jsonlFile = createEmptyFile_(
      rootFolder,
      buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.JSONL_EXTENSION)
    );
  } else {
    csvFile.setName(buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.CSV_EXTENSION));
    jsonlFile.setName(buildLogFileName_(channelName, channelId, part, CONFIG.DRIVE.FILE_NAMING.JSONL_EXTENSION));
  }

  channelSheet.getRange(rowIndex, c.DRIVE_CSV_CURRENT_PART).setValue(part);
  channelSheet.getRange(rowIndex, c.DRIVE_JSONL_CURRENT_PART).setValue(part);
  channelSheet.getRange(rowIndex, c.DRIVE_CSV_CURRENT_FILE_ID).setValue(csvFile.getId());
  channelSheet.getRange(rowIndex, c.DRIVE_JSONL_CURRENT_FILE_ID).setValue(jsonlFile.getId());
  channelSheet.getRange(rowIndex, c.DRIVE_LAST_RENAMED_AT).setValue(new Date());
  ensureCsvHeaderIfNeeded_(csvFile);
  return { csvFile: csvFile, jsonlFile: jsonlFile };
}

function appendMessagesToLogs_(fileCtx, channelId, messages, userResolver) {
  const seenTs = new Set();
  const jsonlLines = [];
  const csvRows = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    const messageTs = toStringSafe_(msg.ts);
    if (!messageTs || seenTs.has(messageTs)) {
      continue;
    }
    seenTs.add(messageTs);
    const record = messageToLogRecord_(msg, userResolver);
    jsonlLines.push(JSON.stringify(record));
    csvRows.push(recordToCsvRow_(record));
  }

  if (jsonlLines.length > 0) {
    appendTextToFile_(fileCtx.jsonlFile, jsonlLines.join("\n") + "\n");
  }
  if (csvRows.length > 0) {
    appendTextToFile_(fileCtx.csvFile, csvRows.join("\n") + "\n");
  }
}

function messageToLogRecord_(msg, userResolver) {
  const ts = toStringSafe_(msg.ts);
  const userId = toStringSafe_(msg.user || msg.bot_id);
  const userName = userResolver.resolve(userId);
  return {
    message_ts: ts,
    thread_ts: toStringSafe_(msg.thread_ts || ts),
    parent_ts: toStringSafe_(msg.thread_ts && msg.thread_ts !== ts ? msg.thread_ts : ""),
    user_id: userId,
    user_name: userName,
    datetime_utc: ts ? new Date(Number(ts) * 1000).toISOString() : "",
    text: toStringSafe_(msg.text),
    subtype: toStringSafe_(msg.subtype),
    reaction_summary: formatReactionSummary_(msg.reactions),
    has_files: Array.isArray(msg.files) && msg.files.length > 0,
  };
}

function recordToCsvRow_(record) {
  const values = [
    record.message_ts,
    record.thread_ts,
    record.parent_ts,
    record.user_id,
    record.user_name,
    record.datetime_utc,
    record.text,
    record.subtype,
    record.reaction_summary,
    record.has_files ? "true" : "false",
  ];
  return values.map(csvEscape_).join(",");
}

function getMaxTsFromMessages_(messages) {
  let maxTs = "";
  for (let i = 0; i < messages.length; i += 1) {
    const ts = toStringSafe_(messages[i].ts);
    if (!ts) {
      continue;
    }
    if (!maxTs || Number(ts) > Number(maxTs)) {
      maxTs = ts;
    }
  }
  return maxTs;
}

function slackConversationsHistory_(params) {
  return slackApiGet_("conversations.history", params);
}

function slackConversationsReplies_(params) {
  return slackApiGet_("conversations.replies", params);
}

function slackConversationsInfo_(channelId) {
  return slackApiGet_("conversations.info", { channel: channelId });
}

function slackUsersInfo_(userId) {
  return slackApiGet_("users.info", { user: userId });
}

function slackApiGet_(method, params) {
  const token = PropertiesService.getScriptProperties().getProperty(CONFIG.SLACK.BOT_TOKEN_PROPERTY_KEY);
  const query = toQueryString_(params || {});
  const url = CONFIG.SLACK.API_BASE_URL + "/" + method + (query ? "?" + query : "");
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + token,
    },
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code === 429) {
    const retryAfter = Number(res.getHeaders()["Retry-After"] || 1);
    Utilities.sleep((retryAfter + 1) * 1000);
    return slackApiGet_(method, params);
  }
  if (code < 200 || code >= 300) {
    throw new Error("Slack API HTTP error " + code + ": " + body);
  }
  const json = JSON.parse(body);
  if (!json.ok) {
    throw new Error("Slack API error (" + method + "): " + json.error);
  }
  return json;
}

function toQueryString_(params) {
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "");
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])));
  }
  return pairs.join("&");
}

function resolveFileByIdOrName_(fileId, folder, expectedName) {
  if (fileId) {
    try {
      return DriveApp.getFileById(fileId);
    } catch (e) {
      // Fall through to name lookup.
    }
  }
  const found = folder.getFilesByName(expectedName);
  if (found.hasNext()) {
    return found.next();
  }
  return createEmptyFile_(folder, expectedName);
}

function createEmptyFile_(folder, fileName) {
  return folder.createFile(fileName, "", MimeType.PLAIN_TEXT);
}

function appendTextToFile_(file, text) {
  const current = file.getBlob().getDataAsString("UTF-8");
  file.setContent(current + text);
}

function ensureCsvHeaderIfNeeded_(csvFile) {
  const current = csvFile.getBlob().getDataAsString("UTF-8");
  if (current && current.length > 0) {
    return;
  }
  appendTextToFile_(csvFile, buildCsvHeaderLine_() + "\n");
}

function buildCsvHeaderLine_() {
  const headers = [
    "message_ts",
    "thread_ts",
    "parent_ts",
    "user_id",
    "user_name",
    "datetime_utc",
    "text",
    "subtype",
    "reaction_summary",
    "has_files",
  ];
  return headers.map(csvEscape_).join(",");
}

function buildLogFileName_(channelName, channelId, part, ext) {
  return (
    sanitizeForFileName_(channelName) +
    CONFIG.DRIVE.FILE_NAMING.SEPARATOR +
    channelId +
    CONFIG.DRIVE.FILE_NAMING.SEPARATOR +
    part +
    ext
  );
}

function sanitizeForFileName_(name) {
  return toStringSafe_(name)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown_channel";
}

function leftPadNumber_(num, width) {
  return String(num).padStart(width, "0");
}

function normalizeBoolean_(value, defaultValue) {
  if (typeof value === "boolean") {
    return value;
  }
  const s = toStringSafe_(value).toLowerCase();
  if (s === "true" || s === "1") {
    return true;
  }
  if (s === "false" || s === "0") {
    return false;
  }
  return defaultValue;
}

function dedupeStrings_(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function shouldRetryErrorThreadQueueItemNow_(retryCount, updatedAt, now) {
  if (!updatedAt) {
    return true;
  }
  // Exponential backoff: base * 2^(retryCount-1), capped.
  const baseMinutes = CONFIG.THREAD_QUEUE.ERROR_RETRY_BASE_MINUTES;
  const maxMinutes = CONFIG.THREAD_QUEUE.ERROR_RETRY_MAX_MINUTES;
  const expMinutes = baseMinutes * Math.pow(2, Math.max(0, retryCount - 1));
  const waitMinutes = Math.min(maxMinutes, expMinutes);
  const nextAtMs = updatedAt.getTime() + waitMinutes * 60 * 1000;
  return now.getTime() >= nextAtMs;
}

function formatReactionSummary_(reactions) {
  if (!Array.isArray(reactions) || reactions.length === 0) {
    return "";
  }
  const parts = [];
  for (let i = 0; i < reactions.length; i += 1) {
    const r = reactions[i];
    const name = toStringSafe_(r && r.name);
    if (!name) {
      continue;
    }
    const count = Number(r && r.count ? r.count : 0);
    parts.push(name + ":" + String(count));
  }
  return parts.join("|");
}

function purgeExpiredDoneThreadQueue_(threadSheet, retentionDays) {
  const lastRow = threadSheet.getLastRow();
  if (lastRow <= 1) {
    return;
  }
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const values = threadSheet
    .getRange(2, 1, lastRow - 1, SHEET_HEADERS.THREAD_QUEUE.length)
    .getValues();

  const deleteRows = [];
  for (let i = 0; i < values.length; i += 1) {
    const rowIndex = i + 2;
    const status = toStringSafe_(values[i][COLS.THREAD_QUEUE.STATUS - 1]);
    if (status !== THREAD_QUEUE_STATUS.DONE) {
      continue;
    }
    const updatedAt = toDateOrNull_(values[i][COLS.THREAD_QUEUE.UPDATED_AT - 1]);
    if (updatedAt && updatedAt.getTime() < cutoffMs) {
      deleteRows.push(rowIndex);
    }
  }

  for (let i = deleteRows.length - 1; i >= 0; i -= 1) {
    threadSheet.deleteRow(deleteRows[i]);
  }
}

function csvEscape_(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function deleteTriggersByHandler_(handlerFunctionName) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    const trigger = triggers[i];
    if (trigger.getHandlerFunction() === handlerFunctionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function renameAllChannelLogFiles_(folder, channelId, channelName) {
  const files = folder.getFiles();
  const sanitized = sanitizeForFileName_(channelName);
  while (files.hasNext()) {
    const file = files.next();
    const parsed = parseLogFileName_(file.getName());
    if (!parsed || parsed.channelId !== channelId) {
      continue;
    }
    const nextName = buildLogFileName_(sanitized, channelId, parsed.part, parsed.ext);
    if (file.getName() !== nextName) {
      file.setName(nextName);
    }
  }
}

function detectLatestPartForChannel_(folder, channelId) {
  const files = folder.getFiles();
  let maxPartNum = 0;
  while (files.hasNext()) {
    const file = files.next();
    const parsed = parseLogFileName_(file.getName());
    if (!parsed || parsed.channelId !== channelId) {
      continue;
    }
    const partNum = Number(parsed.part);
    if (partNum > maxPartNum) {
      maxPartNum = partNum;
    }
  }
  if (maxPartNum <= 0) {
    return "";
  }
  return leftPadNumber_(maxPartNum, CONFIG.DRIVE.FILE_NAMING.PART_PADDING);
}

function parseLogFileName_(name) {
  const escapedSep = CONFIG.DRIVE.FILE_NAMING.SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^(.+)" + escapedSep + "([A-Za-z0-9]+)" + escapedSep + "(\\d{2})(\\.csv|\\.jsonl)$");
  const m = String(name).match(re);
  if (!m) {
    return null;
  }
  return {
    channelName: m[1],
    channelId: m[2],
    part: m[3],
    ext: m[4],
  };
}

function buildUserNameResolver_(ss, maxLookupsPerRun) {
  const sheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.SLACK_USER_CACHE);
  const c = COLS.SLACK_USER_CACHE;
  const cache = {};
  const rowIndexByUserId = {};
  let lookupCount = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.SLACK_USER_CACHE.length).getValues();
    for (let i = 0; i < values.length; i += 1) {
      const rowIndex = i + 2;
      const userId = toStringSafe_(values[i][c.USER_ID - 1]);
      if (!userId) {
        continue;
      }
      const displayName = toStringSafe_(values[i][c.DISPLAY_NAME - 1]);
      const realName = toStringSafe_(values[i][c.REAL_NAME - 1]);
      cache[userId] = displayName || realName || userId;
      rowIndexByUserId[userId] = rowIndex;
    }
  }

  return {
    resolve: function (userId) {
      const id = toStringSafe_(userId);
      if (!id) {
        return "";
      }
      if (cache[id]) {
        return cache[id];
      }
      if (lookupCount >= maxLookupsPerRun) {
        // Cost guard: skip extra users.info calls in this run.
        return id;
      }
      const info = slackUsersInfo_(id);
      lookupCount += 1;
      const user = info.user || {};
      const profile = user.profile || {};
      const displayName = toStringSafe_(profile.display_name || profile.display_name_normalized);
      const realName = toStringSafe_(user.real_name || profile.real_name);
      const resolved = displayName || realName || id;
      cache[id] = resolved;

      const rowValues = [[
        id,
        displayName,
        realName,
        !!user.is_bot,
        !!user.deleted,
        new Date(),
      ]];
      const existingRow = rowIndexByUserId[id];
      if (existingRow) {
        sheet.getRange(existingRow, 1, 1, SHEET_HEADERS.SLACK_USER_CACHE.length).setValues(rowValues);
      } else {
        const newRowIndex = sheet.getLastRow() + 1;
        sheet.getRange(newRowIndex, 1, 1, SHEET_HEADERS.SLACK_USER_CACHE.length).setValues(rowValues);
        rowIndexByUserId[id] = newRowIndex;
      }
      return resolved;
    },
  };
}
