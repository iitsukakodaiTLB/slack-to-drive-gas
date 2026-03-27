/**
 * Web アプリエントリ
 */

function doGet() {
  const html = HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Slack 同期 管理")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}
