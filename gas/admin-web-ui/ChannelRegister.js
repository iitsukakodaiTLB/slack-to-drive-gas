/**
 * 新規チャンネル登録（Slack 名 → ID 解決 → channel_sync_state 行追加）
 */

/**
 * @param {string} raw
 * @returns {string} 比較用（先頭 # 除去・trim・小文字）
 */
function normalizeChannelInputForSlackName_(raw) {
  let s = String(raw || "").trim();
  if (s.charAt(0) === "#") {
    s = s.slice(1).trim();
  }
  return s.toLowerCase();
}

/**
 * @param {Object[]} channels conversations.list の channel
 * @param {string} normalizedTarget normalizeChannelInputForSlackName_ の結果
 * @returns {Object[]}
 */
function filterChannelsByNormalizedName_(channels, normalizedTarget) {
  const t = String(normalizedTarget || "").trim().toLowerCase();
  const matches = [];
  for (let i = 0; i < channels.length; i += 1) {
    const ch = channels[i];
    const name = String(ch.name || "").toLowerCase();
    if (name === t) {
      matches.push(ch);
    }
  }
  return matches;
}

/**
 * @param {string} channelId
 * @param {string} channelName Slack の name（小文字想定）
 * @returns {any[]} 31 列分の 1 行
 */
function buildNewChannelRowValues_(channelId, channelName) {
  const w = SHEET_HEADERS.CHANNEL_SYNC_STATE.length;
  const row = new Array(w);
  for (let i = 0; i < w; i += 1) {
    row[i] = "";
  }
  const c = COLS.CHANNEL_SYNC_STATE;
  const now = new Date();
  const exec = getSpreadsheetExecutorEmail_() || "";

  row[c.STATUS - 1] = STATUS.PENDING;
  row[c.CHANNEL_ID - 1] = String(channelId).trim();
  row[c.CHANNEL_NAME_CURRENT - 1] = String(channelName || "").trim();
  row[c.SYNC_MODE - 1] = SYNC_MODE.BACKFILL;
  row[c.HISTORY_INCLUSIVE - 1] = false;
  row[c.CONSECUTIVE_FAILURES - 1] = 0;
  row[c.REGISTERED_AT - 1] = now;
  row[c.REGISTERED_BY - 1] = exec || "admin_web_ui";
  row[c.UI_LAST_UPDATED_AT - 1] = now;
  row[c.UI_LAST_UPDATED_BY - 1] = exec;

  return row;
}

/**
 * @param {{ channelNameInput?: string }} payload
 * @returns {{
 *   ok: boolean,
 *   message?: string,
 *   code?: string,
 *   channel_id?: string,
 *   channel_name?: string,
 *   sheetRow?: number
 * }}
 */
function apiRegisterChannel(payload) {
  const p = payload || {};
  const rawName = p.channelNameInput;
  if (rawName === undefined || rawName === null || String(rawName).trim() === "") {
    return { ok: false, message: "チャンネル名を入力してください" };
  }

  try {
    const normalized = normalizeChannelInputForSlackName_(rawName);
    if (!normalized) {
      return { ok: false, message: "チャンネル名が空です" };
    }

    const all = slackListAllConversationsForRegister_();
    const matches = filterChannelsByNormalizedName_(all, normalized);

    if (matches.length === 0) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message:
          "一致するチャンネルがありません。名前（# なし・小文字比較）・Bot の参加・非アーカイブを確認してください。",
      };
    }
    if (matches.length > 1) {
      const ids = matches
        .map(function (m) {
          return m.id;
        })
        .join(", ");
      return {
        ok: false,
        code: "MULTIPLE",
        message: "同一名前で複数ヒットしました（想定外）: " + ids,
      };
    }

    const ch = matches[0];
    const channelId = String(ch.id || "").trim();
    const channelName = String(ch.name || "").trim();

    const sheet = getChannelSyncSheet_();
    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);

    const existingRow = findDataRowIndexByChannelId_(sheet, channelId);
    if (existingRow) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: "既に channel_sync_state に登録済みです（シート行 " + existingRow + "）",
        channel_id: channelId,
        sheetRow: existingRow,
      };
    }

    const rowValues = buildNewChannelRowValues_(channelId, channelName);
    sheet.appendRow(rowValues);
    const newRow = sheet.getLastRow();

    return {
      ok: true,
      message: "登録しました。",
      channel_id: channelId,
      channel_name: channelName,
      sheetRow: newRow,
    };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : String(err),
    };
  }
}
