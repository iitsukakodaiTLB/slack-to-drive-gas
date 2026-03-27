/**
 * channel_sync_state 一覧（読み取り・処理優先順ソート）
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
 * @param {*} raw
 * @returns {number|null} epoch ms
 */
function priorityInterruptMs_(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (Object.prototype.toString.call(raw) === "[object Date]") {
    if (isNaN(raw.getTime())) {
      return null;
    }
    return raw.getTime();
  }
  return null;
}

/**
 * @param {*} value
 * @returns {number|null} epoch ms
 */
function cellDateMs_(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) {
      return null;
    }
    return value.getTime();
  }
  return null;
}

/**
 * @param {string} ts Slack ts "sec.micro"
 * @returns {number|null} epoch ms
 */
function slackTsToMs_(ts) {
  const s = String(ts || "").trim();
  if (!s) {
    return null;
  }
  const base = parseFloat(s.split(".")[0], 10);
  if (isNaN(base)) {
    return null;
  }
  return base * 1000;
}

/**
 * @param {number} ms
 * @returns {string} yyyy/MM/dd
 */
function formatDateSlashMs_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), "yyyy/MM/dd");
}

/**
 * @param {Object[]} row
 * @param {Object} c COLS.CHANNEL_SYNC_STATE
 * @returns {string}
 */
function formatDateSlashFromRowStart_(row, c) {
  const ts = String(row[c.HISTORY_OLDEST_TS - 1] || "").trim();
  const ms = slackTsToMs_(ts);
  if (ms != null) {
    return formatDateSlashMs_(ms);
  }
  return "";
}

/**
 * @param {Object[]} row
 * @param {Object} c COLS.CHANNEL_SYNC_STATE
 * @returns {string}
 */
function formatDateSlashFromRowEnd_(row, c) {
  const liveAt = row[c.LIVE_LAST_MESSAGE_AT - 1];
  const dm = cellDateMs_(liveAt);
  if (dm != null) {
    return formatDateSlashMs_(dm);
  }
  const lts = String(row[c.LIVE_LAST_MESSAGE_TS - 1] || "").trim();
  const ms = slackTsToMs_(lts);
  if (ms != null) {
    return formatDateSlashMs_(ms);
  }
  return "";
}

/**
 * @param {Object[]} row
 * @param {Object} c
 * @param {boolean} isBackfill
 * @returns {string}
 */
function buildFetchedRangeDetail_(row, c, isBackfill) {
  const fr = formatDateSlashFromRowStart_(row, c);
  const to = formatDateSlashFromRowEnd_(row, c);
  let core = "";
  if (!fr && !to) {
    core = "取得範囲は未確定です";
  } else if (!fr && to) {
    core = "～ " + to + " までのメッセージを取得済み";
  } else if (fr && !to) {
    core = fr + " ～ （終端日未確定）までのメッセージを取得済み";
  } else {
    core = fr + " ～ " + to + " までのメッセージを取得済み";
  }
  if (isBackfill) {
    return core + "（バックフィル継続中）";
  }
  return core;
}

/**
 * @param {Object[]} row
 * @param {Object} c
 * @returns {{ label: string, detail: string }}
 */
function computeFetchStatusBundle_(row, c) {
  const st = String(row[c.STATUS - 1] || "").trim();
  const syncMode = String(row[c.SYNC_MODE - 1] || "").trim();
  const historyOldest = String(row[c.HISTORY_OLDEST_TS - 1] || "").trim();
  const liveTs = String(row[c.LIVE_LAST_MESSAGE_TS - 1] || "").trim();
  const sortRun = row[c.SORT_LAST_RUN_AT - 1];
  const liveAt = row[c.LIVE_LAST_MESSAGE_AT - 1];

  if (st === STATUS.DISABLED) {
    return { label: "無効", detail: "—" };
  }

  if (syncMode === SYNC_MODE.LIVE) {
    return {
      label: "最新まで取得",
      detail: buildFetchedRangeDetail_(row, c, false),
    };
  }

  if (syncMode === SYNC_MODE.BACKFILL) {
    const neverStarted =
      cellDateMs_(sortRun) == null &&
      !liveTs &&
      !historyOldest &&
      cellDateMs_(liveAt) == null;
    if (neverStarted) {
      return { label: "未取得", detail: "まだメッセージを取得していません" };
    }
    return {
      label: "過去ログの取得中",
      detail: buildFetchedRangeDetail_(row, c, true),
    };
  }

  const hasAny = !!(liveTs || historyOldest || cellDateMs_(liveAt) != null);
  return {
    label: hasAny ? "過去ログの取得中" : "未取得",
    detail: hasAny ? buildFetchedRangeDetail_(row, c, true) : "まだメッセージを取得していません",
  };
}

/**
 * 同期ワーカー §6.3 に準拠（DISABLED は一覧の末尾）
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function compareRowsByWorkerPriority_(a, b) {
  const da = a.status === STATUS.DISABLED;
  const db = b.status === STATUS.DISABLED;
  if (da !== db) {
    return da ? 1 : -1;
  }

  const ha = a._sortPri != null;
  const hb = b._sortPri != null;
  if (ha !== hb) {
    return ha ? -1 : 1;
  }
  if (ha && a._sortPri !== b._sortPri) {
    return a._sortPri - b._sortPri;
  }

  const sa = a._sortRun != null ? a._sortRun : 0;
  const sb = b._sortRun != null ? b._sortRun : 0;
  if (sa !== sb) {
    return sa - sb;
  }

  const la = a._sortLive != null ? a._sortLive : 0;
  const lb = b._sortLive != null ? b._sortLive : 0;
  if (la !== lb) {
    return la - lb;
  }

  const ra = a._sortReg != null ? a._sortReg : 0;
  const rb = b._sortReg != null ? b._sortReg : 0;
  return ra - rb;
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

      const fetchB = computeFetchStatusBundle_(row, c);
      const errAt = serializeCellForClient_(row[c.LAST_ERROR_AT - 1]);
      const errMsg = truncateText_(serializeCellForClient_(row[c.LAST_ERROR_MESSAGE - 1]), 200);
      let errLine = "";
      if (errAt || errMsg) {
        errLine = (errAt ? errAt : "—") + (errMsg ? " / " + errMsg : "");
      }

      const priMs = priorityInterruptMs_(row[c.PRIORITY_INTERRUPT_AT - 1]);
      const dto = {
        sheetRow: i + 2,
        channel_id: serializeCellForClient_(row[c.CHANNEL_ID - 1]),
        channel_name_current: serializeCellForClient_(row[c.CHANNEL_NAME_CURRENT - 1]),
        status: status,
        fetch_status_label: fetchB.label,
        fetch_status_detail: fetchB.detail,
        sort_last_run_at: serializeCellForClient_(row[c.SORT_LAST_RUN_AT - 1]),
        last_error_line: errLine,
        priority_interrupt_at_empty: priMs == null,
        can_toggle_enabled: status === STATUS.WAITING || status === STATUS.DISABLED,
        toggle_enabled_label: status === STATUS.WAITING ? "無効化" : status === STATUS.DISABLED ? "有効化" : "",
        note: String(row[c.NOTE - 1] != null ? row[c.NOTE - 1] : ""),
        _sortPri: priMs,
        _sortRun: cellDateMs_(row[c.SORT_LAST_RUN_AT - 1]),
        _sortLive: cellDateMs_(row[c.LIVE_LAST_MESSAGE_AT - 1]),
        _sortReg: cellDateMs_(row[c.REGISTERED_AT - 1]),
      };
      matched.push(dto);
    }

    matched.sort(compareRowsByWorkerPriority_);

    for (let j = 0; j < matched.length; j += 1) {
      delete matched[j]._sortPri;
      delete matched[j]._sortRun;
      delete matched[j]._sortLive;
      delete matched[j]._sortReg;
    }

    const totalFiltered = matched.length;
    const start = page * pageSize;
    const pageRows = matched.slice(start, start + pageSize);
    const totalPages = totalFiltered === 0 ? 0 : Math.ceil(totalFiltered / pageSize);

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
