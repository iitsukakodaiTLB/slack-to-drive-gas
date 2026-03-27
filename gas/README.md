# GAS プロジェクト（モノレポ内）

| ディレクトリ | 役割 |
|--------------|------|
| `slack-sync-worker/` | Slack → Drive 同期ワーカー（時間主導トリガー等） |
| `admin-web-ui/` | 管理用 Web UI（別 GAS。`.clasp.json` は初回 `clasp create` / `clone` 後に配置） |

## clasp の向け先

各フォルダに **その GAS 用の `.clasp.json`**（`scriptId`）を置き、そのディレクトリをカレントにして操作する。

```bash
cd gas/slack-sync-worker
clasp push    # または clasp pull / open / logs
```

ルートから npm 経由で同じことをする場合は [README.md](../README.md) の npm scripts を参照。

## admin-web-ui

ソースと `appsscript.json`・`.clasp.json` をまだ置いていない場合は、上記の `cd` / `clasp` の前にプロジェクトを作成する。
