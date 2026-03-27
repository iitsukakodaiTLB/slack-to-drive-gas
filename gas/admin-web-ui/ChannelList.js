/**
 * channel_sync_state 一覧（読み取り）
 */

/**
 * @param {*} value
 * @returns {string}
 */
function serializeCellForClient_(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  }
  return String(value);
}

/**
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function truncateText_(s, max) {
  const t = String(s || "");
  if (t.length <= max) {
    return t;
  }
  return t.substring(0, max) + "…";
}

/**
 * @param {{
 *   status?: string,
 *   errorsOnly?: boolean,
 *   page?: number,
 *   pageSize?: number
 * }} filter
 * @returns {{
 *   ok: boolean,
 *   message?: string,
 *   rows: Object[],
 *   totalFiltered: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number
 * }}
 */
function apiListChannels(filter) {
  const f = filter || {};
  const statusFilter = String(f.status || "").trim();
  const errorsOnly = !!f.errorsOnly;
  let page = parseInt(f.page, 10);
  if (isNaN(page) || page < 0) {
    page = 0;
  }
  let pageSize = parseInt(f.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) {
    pageSize = CONFIG.LIST_PAGE_SIZE;
  }
  if (pageSize > CONFIG.LIST_PAGE_SIZE) {
    pageSize = CONFIG.LIST_PAGE_SIZE;
  }

  try {
    const sheet = getChannelSyncSheet_();
    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);

    const lastRow = sheet.getLastRow();
    const width = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
    const c = COLS.CHANNEL_SYNC_STATE;

    if (lastRow < 2) {
      return {
        ok: true,
        rows: [],
        totalFiltered: 0,
        page: 0,
        pageSize: pageSize,
        totalPages: 0,
      };
    }

    const values = sheet.getRange(2, 1, lastRow, width).getValues();
    const matched = [];

    for (let i = 0; i < values.length; i += 1) {
      const row = values[i];
      const channelId = String(row[c.CHANNEL_ID - 1] || "").trim();
      if (!channelId) {
        continue;
      }

      const status = String(row[c.STATUS - 1] || "").trim();
      const lastErrRaw = row[c.LAST_ERROR_AT - 1];
      const lastErrStr = serializeCellForClient_(lastErrRaw).trim();
      const hasErrAt = lastErrStr !== "";
      const isErrorStatus = status === STATUS.ERROR;

      if (errorsOnly && !hasErrAt && !isErrorStatus) {
        continue;
      }
      if (statusFilter && status !== statusFilter) {
        continue;
      }

      matched.push({
        sheetRow: i + 2,
        channel_id: serializeCellForClient_(row[c.CHANNEL_ID - 1]),
        channel_name_current: serializeCellForClient_(row[c.CHANNEL_NAME_CURRENT - 1]),
        status: status,
        sort_last_run_at: serializeCellForClient_(row[c.SORT_LAST_RUN_AT - 1]),
        live_last_message_at: serializeCellForClient_(row[c.LIVE_LAST_MESSAGE_AT - 1]),
        last_error_at: serializeCellForClient_(row[c.LAST_ERROR_AT - 1]),
        last_error_message: truncateText_(
          serializeCellForClient_(row[c.LAST_ERROR_MESSAGE - 1]),
          120
        ),
        ui_last_updated_at: serializeCellForClient_(row[c.UI_LAST_UPDATED_AT - 1]),
      });
    }

    const totalFiltered = matched.length;
    const start = page * pageSize;
    const pageRows = matched.slice(start, start + pageSize);
    const totalPages =
      totalFiltered === 0 ? 0 : Math.ceil(totalFiltered / pageSize);

    return {
      ok: true,
      rows: pageRows,
      totalFiltered: totalFiltered,
      page: page,
      pageSize: pageSize,
      totalPages: totalPages,
    };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
      rows: [],
      totalFiltered: 0,
      page: 0,
      pageSize: pageSize,
      totalPages: 0,
    };
  }
}
