/**
 * クライアント（HTML）から google.script.run で呼ぶ API
 */

/**
 * 接続・ヘッダー・操作者メールの診断（書き込みなし）
 * @returns {{
 *   ok: boolean,
 *   spreadsheetIdSet: boolean,
 *   channelSheetFound: boolean,
 *   headerOk: boolean,
 *   message: string,
 *   actorEmail: string,
 *   actorEmailWarning: string
 * }}
 */
function apiGetHealth() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(CONFIG.SPREADSHEET.ID_PROPERTY_KEY);
  const result = {
    ok: false,
    spreadsheetIdSet: !!(id && String(id).trim()),
    channelSheetFound: false,
    headerOk: false,
    message: "",
    actorEmail: "",
    actorEmailWarning: "",
  };

  try {
    result.actorEmail = getActorEmail_();
    if (!result.actorEmail) {
      result.actorEmailWarning =
        "操作者メールを取得できませんでした。Web アプリのデプロイで「実行ユーザー」が「アプリにアクセスしているユーザー」になっているか、またはドメイン・ログイン状態を確認してください。空のままでは監査列への記録が困難です。詳細は README を参照。";
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
