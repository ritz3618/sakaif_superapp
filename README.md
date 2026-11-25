# sakaif_superapp

家族用スーパーアプリ(複数の機能を1つに載せる Web アプリの器)。Cloudflare Workers + D1 で動く PWA。
最初の機能は「育児ログ」。ぴよログのデータフィードを使った育児記録の表示・通知(第3段階で実装)。

- 要件と決定事項: 引き継ぎメモ(Claude Docs)
- Cloudflare の準備と iPhone での確認: [docs/cloudflare-setup.md](docs/cloudflare-setup.md)

## 構成

```
src/
  worker.ts            Worker の入口(core と features を組み合わせるだけ)
  main.tsx             画面の入口(同上)
  core/                器。個別の機能を一切知らない
    shared/            サーバーと画面の両方で使う型(機能の宣言 defineFeature など)
    server/            ログイン、PWA、通知(Web Push)、定期実行、D1 マイグレーション
      feature-api.ts   機能のサーバー側が使ってよい唯一の入口
    web/               ホーム、共通ヘッダー、設定画面、通知の登録
      feature-api.ts   機能の画面側が使ってよい唯一の入口
  features/
    registry*.ts       機能のフォルダを自動で集める
    piyolog/           feature.ts(宣言)/ server.ts / web.tsx / migrations/*.sql
    dummy/             ダミー1〜8
public/sw.js           Service Worker(通知の受信、タップしたときの画面遷移)
test/                  単体テストと、境界ルールの検査
```

## 新しい機能の足し方

1. `src/features/<フォルダ名>/feature.ts` に、`defineFeature({ id, name, kind, color, order })` を書く。これだけでホームに並ぶ。
2. 必要なら `server.ts`(`defineFeatureServer`)、`web.tsx`(画面)、`migrations/0001_*.sql` を足す。
3. 守ること(`npm test` で自動検査):
   - 機能は、ほかの機能を読み込まない。core からは `core/shared/*` と `feature-api.ts` だけを使う。
   - D1 のテーブル名は `<フォルダ名>_` で始める。共通部分は `core_`。
   - マイグレーションは追加のみ(適用済みのファイルは書き換えない)。Worker が起動時に自動で適用する。

## 開発

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカルではログインを省略する(localhost のみ有効)
npm run dev                      # http://localhost:5173
npm run check                    # 型チェック + テスト + ビルド
```

秘密情報(フィードURL、トークンなど)は、コードにもこのリポジトリにも書かない。Cloudflare のシークレット、または設定画面からの入力だけにする。
