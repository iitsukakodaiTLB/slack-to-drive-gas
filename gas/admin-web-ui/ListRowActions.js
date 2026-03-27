/**
 * 一覧行からの短い操作（優先申請・WAITING/DISABLED 切替・Note のみ保存）
 */

/**
 * @param {number|string} sheetRow
 * @returns {{ ok: boolean, message?: string }}
 */
function apiRequestPriorityInterrupt(sheetRow) {
  const row = parseInt(sheetRow, 10);
  if (isNaN(row) || row < 2) {
    return { ok: false, message: "sheetRow が不正です" };
  }

  try {
    const sheet = getChannelSyncSheet_();
    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);
    if (row > sheet.getLastRow()) {
      return { ok: false, message: "行が存在しません" };
    }

    const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
    const c = COLS.CHANNEL_SYNC_STATE;
    const rowVals = sheet.getRange(row, 1, row, width).getValues()[0];

    const channelId = String(rowVals[c.CHANNEL_ID - 1] || "").trim();
    if (!channelId) {
      return { ok: false, message: "この行には channel_id がありません" };
    }

    if (priorityInterruptMs_(rowVals[c.PRIORITY_INTERRUPT_AT - 1]) != null) {
      return { ok: false, message: "既に優先申請が設定されています" };
    }

    sheet.getRange(row, c.PRIORITY_INTERRUPT_AT).setValue(new Date());
    sheet.getRange(row, c.UI_LAST_UPDATED_AT).setValue(new Date());
    sheet.getRange(row, c.UI_LAST_UPDATED_BY).setValue(getSpreadsheetExecutorEmail_() || "");

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
    };
  }
}

/**
 * @param {number|string} sheetRow
 * @returns {{ ok: boolean, message?: string }}
 */
function apiToggleWaitingDisabled(sheetRow) {
  const row = parseInt(sheetRow, 10);
  if (isNaN(row) || row < 2) {
    return { ok: false, message: "sheetRow が不正です" };
  }

  try {
    const sheet = getChannelSyncSheet_();
    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);
    if (row > sheet.getLastRow()) {
      return { ok: false, message: "行が存在しません" };
    }

    const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
    const c = COLS.CHANNEL_SYNC_STATE;
    const rowVals = sheet.getRange(row, 1, row, width).getValues()[0];

    const channelId = String(rowVals[c.CHANNEL_ID - 1] || "").trim();
    if (!channelId) {
      return { ok: false, message: "この行には channel_id がありません" };
    }

    const st = String(rowVals[c.STATUS - 1] || "").trim();
    let next = "";
    if (st === STATUS.WAITING) {
      next = STATUS.DISABLED;
    } else if (st === STATUS.DISABLED) {
      next = STATUS.WAITING;
    } else {
      return { ok: false, message: "WAITING / DISABLED のときのみ切り替えできます" };
    }

    sheet.getRange(row, c.STATUS).setValue(next);
    sheet.getRange(row, c.UI_LAST_UPDATED_AT).setValue(new Date());
    sheet.getRange(row, c.UI_LAST_UPDATED_BY).setValue(getSpreadsheetExecutorEmail_() || "");

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
    };
  }
}

/**
 * @param {{ sheetRow: number|string, note?: string }} payload
 * @returns {{ ok: boolean, message?: string }}
 */
function apiQuickSaveNote(payload) {
  const p = payload || {};
  const sheetRow = parseInt(p.sheetRow, 10);
  if (isNaN(sheetRow) || sheetRow < 2) {
    return { ok: false, message: "sheetRow が不正です" };
  }

  try {
    const sheet = getChannelSyncSheet_();
    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);
    if (sheetRow > sheet.getLastRow()) {
      return { ok: false, message: "行が存在しません" };
    }

    const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
    const c = COLS.CHANNEL_SYNC_STATE;
    const rowVals = sheet.getRange(sheetRow, 1, sheetRow, width).getValues()[0];

    const channelId = String(rowVals[c.CHANNEL_ID - 1] || "").trim();
    if (!channelId) {
      return { ok: false, message: "この行には channel_id がありません" };
    }

    const note = p.note !== undefined && p.note !== null ? String(p.note) : "";
    sheet.getRange(sheetRow, c.NOTE).setValue(note);
    sheet.getRange(sheetRow, c.UI_LAST_UPDATED_AT).setValue(new Date());
    sheet.getRange(sheetRow, c.UI_LAST_UPDATED_BY).setValue(getSpreadsheetExecutorEmail_() || "");

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
    };
  }
}
