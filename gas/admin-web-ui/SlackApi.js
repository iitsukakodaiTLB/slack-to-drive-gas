/**
 * Slack Web API（Bot Token・GET のみ）
 */

function getSlackBotTokenOrThrow_() {
  const token = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SLACK.BOT_TOKEN_PROPERTY_KEY
  );
  if (!token || String(token).trim() === "") {
    throw new Error(
      "Script Properties に " + CONFIG.SLACK.BOT_TOKEN_PROPERTY_KEY + " を設定してください"
    );
  }
  return String(token).trim();
}

/**
 * @param {Object} params
 * @returns {string}
 */
function slackToQueryString_(params) {
  const keys = Object.keys(params || {}).filter(function (k) {
    const v = params[k];
    return v !== undefined && v !== null && v !== "";
  });
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])));
  }
  return pairs.join("&");
}

/**
 * @param {string} method API メソッド名（例: conversations.list）
 * @param {Object} params クエリパラメータ
 * @returns {Object} レスポンス JSON（ok=true）
 */
function slackApiGet_(method, params) {
  const token = getSlackBotTokenOrThrow_();
  const query = slackToQueryString_(params || {});
  const url =
    CONFIG.SLACK.API_BASE_URL + "/" + method + (query.length ? "?" + query : "");
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
    throw new Error("Slack API HTTP " + code + ": " + body);
  }
  const json = JSON.parse(body);
  if (!json.ok) {
    throw new Error("Slack API " + method + ": " + (json.error || "unknown_error"));
  }
  return json;
}

/**
 * 非アーカイブの公開チャンネルのみ（`channels:read` で足りる想定。private は MVP 対象外）
 * @returns {Object[]} Slack channel オブジェクトの配列
 */
function slackListAllConversationsForRegister_() {
  const all = [];
  let cursor = "";
  const limit = CONFIG.SLACK.CONVERSATIONS_LIST_LIMIT;
  const maxPages = CONFIG.SLACK.CONVERSATIONS_LIST_MAX_PAGES;

  for (let page = 0; page < maxPages; page += 1) {
    const params = {
      types: "public_channel",
      exclude_archived: true,
      limit: limit,
    };
    if (cursor) {
      params.cursor = cursor;
    }
    const json = slackApiGet_("conversations.list", params);
    const channels = json.channels || [];
    for (let i = 0; i < channels.length; i += 1) {
      all.push(channels[i]);
    }
    const next =
      json.response_metadata && json.response_metadata.next_cursor
        ? String(json.response_metadata.next_cursor)
        : "";
    if (!next) {
      break;
    }
    cursor = next;
  }
  return all;
}
