/**
 * channel_sync_state 1 行の詳細取得・許可された列の更新
 */

/**
 * @param {string} currentStatus
 * @returns {string[]}
 */
function getAllowedStatusTargets_(currentStatus) {
  const s = String(currentStatus || "").trim();
  const map = {
    PENDING: [STATUS.DISABLED],
    WAITING: [STATUS.DISABLED],
    ERROR: [STATUS.PENDING, STATUS.WAITING, STATUS.DISABLED],
    DISABLED: [STATUS.PENDING, STATUS.WAITING],
    RUNNING: [],
    "": [],
  };
  return map[s] ? map[s].slice() : [];
}

/**
 * @param {Date} d
 * @returns {string} datetime-local 用
 */
function toDatetimeLocalValue_(d) {
  if (!d || Object.prototype.toString.call(d) !== "[object Date]" || isNaN(d.getTime())) {
    return "";
  }
  const tz = Session.getScriptTimeZone();
  return (
    Utilities.formatDate(d, tz, "yyyy-MM-dd") + "T" + Utilities.formatDate(d, tz, "HH:mm")
  );
}

/**
 * @param {string} s
 * @returns {Date}
 */
function parseDateTimeLocalString_(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) {
    throw new Error("priority_interrupt_at は YYYY-MM-DDTHH:mm 形式で指定してください");
  }
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const h = parseInt(m[4], 10);
  const mi = parseInt(m[5], 10);
  return new Date(y, mo, d, h, mi, 0, 0);
}

/**
 * @param {number|string} sheetRow
 * @returns {{
 *   ok: boolean,
 *   message?: string,
 *   sheetRow?: number,
 *   currentStatus?: string,
 *   allowedStatusTargets?: string[],
 *   statusUiLocked?: boolean,
 *   fields?: Object.<string, string>,
 *   priority_interrupt_at_input?: string
 * }}
 */
function apiGetChannelDetail(sheetRow) {
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
    const values = sheet.getRange(row, 1, row, width).getValues()[0];
    const headers = SHEET_HEADERS.CHANNEL_SYNC_STATE;
    const c = COLS.CHANNEL_SYNC_STATE;

    const channelId = String(values[c.CHANNEL_ID - 1] || "").trim();
    if (!channelId) {
      return { ok: false, message: "この行には channel_id がありません" };
    }

    const fields = {};
    for (let i = 0; i < headers.length; i += 1) {
      fields[headers[i]] = serializeCellForClient_(values[i]);
    }

    const currentStatus = String(values[c.STATUS - 1] || "").trim();
    const allowed = getAllowedStatusTargets_(currentStatus);
    const statusUiLocked = allowed.length === 0;

    const rawPri = values[c.PRIORITY_INTERRUPT_AT - 1];
    let priInput = "";
    if (Object.prototype.toString.call(rawPri) === "[object Date]" && !isNaN(rawPri.getTime())) {
      priInput = toDatetimeLocalValue_(rawPri);
    }

    return {
      ok: true,
      sheetRow: row,
      currentStatus: currentStatus,
      allowedStatusTargets: allowed,
      statusUiLocked: statusUiLocked,
      fields: fields,
      fieldOrder: Array.prototype.slice.call(headers),
      priority_interrupt_at_input: priInput,
    };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
    };
  }
}

/**
 * @param {{
 *   sheetRow: number|string,
 *   status?: string,
 *   note?: string,
 *   priority_interrupt_at?: string|null
 * }} payload
 * @returns {{ ok: boolean, message?: string }}
 */
function apiUpdateChannel(payload) {
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

    const currentStatus = String(rowVals[c.STATUS - 1] || "").trim();
    const requestedStatus =
      p.status !== undefined && p.status !== null ? String(p.status).trim() : null;

    if (requestedStatus !== null && requestedStatus !== currentStatus) {
      if (currentStatus === STATUS.RUNNING) {
        return { ok: false, message: "RUNNING 中は status を変更できません" };
      }
      const allowed = getAllowedStatusTargets_(currentStatus);
      if (allowed.indexOf(requestedStatus) === -1) {
        return {
          ok: false,
          message: "許可されていない status 遷移です: " + currentStatus + " → " + requestedStatus,
        };
      }
      sheet.getRange(sheetRow, c.STATUS).setValue(requestedStatus);
    }

    if (p.note !== undefined && p.note !== null) {
      sheet.getRange(sheetRow, c.NOTE).setValue(String(p.note));
    }

    if (Object.prototype.hasOwnProperty.call(p, "priority_interrupt_at")) {
      const v = p.priority_interrupt_at;
      if (v === null || v === undefined) {
        // 送らない運用
      } else if (String(v).trim() === "") {
        sheet.getRange(sheetRow, c.PRIORITY_INTERRUPT_AT).clearContent();
      } else {
        sheet.getRange(sheetRow, c.PRIORITY_INTERRUPT_AT).setValue(parseDateTimeLocalString_(v));
      }
    }

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
