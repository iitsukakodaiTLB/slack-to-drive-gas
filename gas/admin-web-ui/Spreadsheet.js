/**
 * スプレッドシートを開き、ヘッダー検証のみ（シートの自動作成はしない）
 */

function getSettingsSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SPREADSHEET.ID_PROPERTY_KEY
  );
  if (!id || String(id).trim() === "") {
    throw new Error(
      "Script Properties に " + CONFIG.SPREADSHEET.ID_PROPERTY_KEY + " が設定されていません。"
    );
  }
  return SpreadsheetApp.openById(String(id).trim());
}

function getChannelSyncSheet_() {
  const ss = getSettingsSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE);
  if (!sheet) {
    throw new Error(
      'シートが見つかりません: "' + CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE + '"'
    );
  }
  return sheet;
}

/**
 * 1 行目ヘッダーが SHEET_HEADERS と一致するか検証する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} expectedHeaders
 */
function validateSheetHeaderRow_(sheet, expectedHeaders) {
  const width = expectedHeaders.length;
  if (sheet.getLastColumn() < width) {
    throw new Error(
      "列数が不足しています（必要 " + width + " 列、実際 " + sheet.getLastColumn() + " 列）。"
    );
  }
  const actualHeaders = sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .map((value) => String(value).trim());

  const mismatches = [];
  for (let i = 0; i < width; i += 1) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      mismatches.push(
        "列 " +
          (i + 1) +
          ': 期待 "' +
          expectedHeaders[i] +
          '" / 実際 "' +
          actualHeaders[i] +
          '"'
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error("ヘッダー不一致:\n" + mismatches.join("\n"));
  }
}

/**
 * スプレッドシートを実際に触る権限の主体（Web アプリ「自分として実行」＝通常はデプロイ担当者）
 * @returns {string}
 */
function getSpreadsheetExecutorEmail_() {
  try {
    const u = Session.getEffectiveUser();
    if (u) {
      return String(u.getEmail() || "").trim();
    }
  } catch (e) {
    // ignore
  }
  return "";
}

/**
 * ブラウザでログインしているユーザー（「アクセスしているユーザーとして実行」のときのみ取れることが多い）。
 * 運用方針で「自分として実行」の場合は空になりやすい。監査には使わない。
 * @returns {string}
 */
function getVisitorEmailForDebug_() {
  try {
    const u = Session.getActiveUser();
    if (u) {
      return String(u.getEmail() || "").trim();
    }
  } catch (e) {
    // ignore
  }
  return "";
}
