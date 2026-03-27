/**
 * クライアント（HTML）から google.script.run で呼ぶ API
 */

/**
 * 接続・ヘッダー・実行主体メールの診断（書き込みなし）
 * @returns {{
 *   ok: boolean,
 *   spreadsheetIdSet: boolean,
 *   channelSheetFound: boolean,
 *   headerOk: boolean,
 *   message: string,
 *   spreadsheetExecutorEmail: string,
 *   visitorEmail: string,
 *   policyNote: string,
 *   warning: string
 * }}
 */
function apiGetHealth() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(CONFIG.SPREADSHEET.ID_PROPERTY_KEY);
  const policyNote =
    "運用方針: スプレッドシートへの読み書きは「ウェブアプリのデプロイで選んだ実行ユーザー」の権限で行います。" +
    "「自分」としてデプロイしている場合、来訪者ごとの操作者メールは記録しません（ui_last_updated_by は空またはデプロイ者固定など実装で統一）。";

  const result = {
    ok: false,
    spreadsheetIdSet: !!(id && String(id).trim()),
    channelSheetFound: false,
    headerOk: false,
    message: "",
    spreadsheetExecutorEmail: "",
    visitorEmail: "",
    policyNote: policyNote,
    warning: "",
  };

  try {
    result.spreadsheetExecutorEmail = getSpreadsheetExecutorEmail_();
    result.visitorEmail = getVisitorEmailForDebug_();

    if (!result.spreadsheetExecutorEmail) {
      result.warning =
        "実行主体（Session.getEffectiveUser）のメールを取得できませんでした。エディタからのテスト実行と、ウェブアプリ URL からの実行で結果が異なる場合があります。";
    }

    if (!result.spreadsheetIdSet) {
      result.message = CONFIG.SPREADSHEET.ID_PROPERTY_KEY + " が未設定です。";
      return result;
    }

    const ss = getSettingsSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SPREADSHEET.SHEETS.CHANNEL_SYNC_STATE);
    result.channelSheetFound = !!sheet;
    if (!sheet) {
      result.message = "channel_sync_state シートが見つかりません。";
      return result;
    }

    validateSheetHeaderRow_(sheet, SHEET_HEADERS.CHANNEL_SYNC_STATE);
    result.headerOk = true;
    result.ok = true;
    result.message = "接続・ヘッダーは正常です。";
    return result;
  } catch (err) {
    result.message = err && err.message ? String(err.message) : String(err);
    return result;
  }
}
