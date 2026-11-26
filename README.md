# sakaif_superapp

家族用スーパーアプリ(複数の機能を1つに載せる Web アプリの器)。Cloudflare Workers + D1 で動く PWA。
最初の機能は「育児ログ」。ぴよログのデータフィードを5分おきに取得して D1 に保存し、経過時間・今日と昨日を過去1週間と比べた表・最近の体温など・今日と昨日の時間の帯の表示と、授乳・おむつ替え・フィード期限の通知を行う。
過去の記録は、ぴよログの「月ごとのテキスト」を画面から取り込める。保存した記録は CSV で書き出せる。
育児ログは、SwitchBot(Hub 2 など)の室温・湿度も5分おきに読み、画面に出す(基準の外なら注意、通知は初期値オフ)。値は共通データ(source "switchbot")に置き、ほかの機能からも使える。

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
    piyolog/           育児ログ。feature.ts(宣言)/ server.ts / web.tsx / migrations/*.sql
    dummy/             ダミー1〜8(ホームのカードを9枚にするための仮の機能)
public/sw.js           Service Worker(通知の受信、タップしたときの画面遷移)
test/                  単体テストと、境界ルールの検査
```

## 新しい機能の足し方

1. `src/features/<フォルダ名>/feature.ts` に、`defineFeature({ id, name, kind, color, order })` を書く。これだけでホームに並ぶ。
2. 必要なら `server.ts`(`defineFeatureServer`)、`web.tsx`(画面)、`migrations/0001_*.sql` を足す。
   - 設定: `feature.ts` の `settings` に項目を宣言すると、設定画面に自動で出る。
     種類は `boolean` / `minutes` / `timeRanges` / `date` / `text` / `number`(単位付き) / `select`(選択肢) /
     `secret`(秘密の値は画面に表示されない)。
     保存先は `scope: "shared"`(夫婦共通)か `"user"`(ユーザーごと)。サーバー側では `ctx.settings.get(key, userId?)` で読む。
   - 通知: `feature.ts` の `notifications` に種類を宣言し、定期実行の中で `ctx.notify({ type, to, dedupeKey, title, body, url })` を呼ぶ。
     オン/オフ、通知を避ける時間帯(明けたときに送る)、重複防止(`dedupeKey` が同じなら1回だけ)、履歴は共通部分が処理する。
   - 定期実行: `scheduled.run` が例外を投げると失敗として数え、続けて失敗したら全員にエラー通知を送る(各自オフにできる)。
   - 共通データ: ほかの機能と使い回したい記録(育児の記録、温湿度など)は、`feature.ts` の `dataSources` に出どころを宣言し、
     `ctx.data.applySnapshot(...)`(ある期間の全件を反映)や `ctx.data.upsert(...)`(追記)で、共通の表 `core_records` に書く。
     読み出しは、どの機能からも `ctx.data.query(source, ...)` / `ctx.data.latest(...)` でできる。書けるのは宣言した機能だけ。
   - 見た目: 画面は `core/web/feature-api` の共通部品(`Panel`、`Stat`、`StatGrid`、`BigValue`、`Trend`、`Note`、`Button`、
     `CompareTable`(比べる表)、`Timeline`(時間の帯)、`FileButton`)で作る。注意を引きたいときは `tone="warn"`。
     機能ごとの調整は、その機能の CSS に、クラス名「<フォルダ名>-」か `[data-feature="<機能ID>"]` の中でだけ書く。
     共通の値(`--radius-lg`、`--font-xl` など)も、`[data-feature="<機能ID>"]` の中で上書きできる。機能の色は `var(--feature-color)`。
3. 守ること(`npm test` で自動検査):
   - 機能は、ほかの機能を読み込まない。core からは `core/shared/*` と `feature-api.ts` だけを使う。
   - core には、個別の機能の名前やIDを書かない(コメントも含む)。
   - 機能の CSS は、その機能の中だけに効く書き方にする(上の「見た目」)。
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
