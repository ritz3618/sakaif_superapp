# Cloudflare の準備と、iPhone での確認手順

あなた(ユーザー)にしかできない作業の手順です。手順は、2026-11-24 時点の Cloudflare 公式ドキュメントで確認しました。画面の表記が違う場合は、スクリーンショットを Claude に送ってください。

秘密情報(フィードURL、トークン、パスワード、ワンタイムコード)は、チャットにもこのリポジトリにも書かないでください。D1 の Database ID と Access の AUD タグは、秘密情報ではありません(それだけでは何もできません)。

## 手順1: アカウントと D1(今すぐできます)

1. [Cloudflare に登録](https://dash.cloudflare.com/sign-up)し、メールアドレスを確認します。二段階認証も有効にしてください。
2. **Workers & Pages** を開き、workers.dev のサブドメインを決めます。
   - 公開URLは `https://sabu6.<サブドメイン>.workers.dev` になります。
   - サブドメインは早い者勝ちです。あとから変えると、ホーム画面のアイコンと通知の許可を、夫婦それぞれがやり直すことになります。
3. **D1 SQL database** → **Create Database** を選びます。
   - 名前: `superapp`(D1 の名前。Worker 名の sabu6 とは別で、このままで問題ありません)
   - Location(任意): Asia-Pacific を選べる場合は、それを選びます。
4. 作成した D1 の **Database ID** を、Claude に伝えてください。Claude が `wrangler.jsonc` に書き込みます。

## 手順2: GitHub との連携(Claude が設定ファイルを更新し、main に取り込んだあと)

1. **Workers & Pages** → **Create** → GitHub のリポジトリを取り込む(Import a repository)を選びます。
2. 案内に従って、Cloudflare の GitHub アプリに、このリポジトリへのアクセスを許可します。
3. 設定は次のとおりです。
   - Worker の名前: `sabu6`(`wrangler.jsonc` の name と同じにする)
   - 本番のブランチ: `main`
   - Build command: `npm run check`(型チェック、テスト、ビルド。テストが失敗すると公開されません)
   - Deploy command: `npx wrangler deploy`(既定のまま)
4. 最初のビルドが成功したら、公開URLを開きます。「表示できません(503)」と出れば、ここまでは正常です(まだログインの設定が無いため、わざと表示しない作りになっています)。

## 手順3: ログイン(Cloudflare Access)

1. **Zero Trust** を開き、チーム名を決めます。
   - Free プランを選びます。公式の説明では、Free プランでも支払い情報の入力が必要ですが、請求はされません。
   - チーム名は、ログイン画面のURL(`<チーム名>.cloudflareaccess.com`)になります。
2. 奥さまは Cloudflare アカウントを持っていないので、メールのワンタイムコードでログインできるようにします。
   - **Zero Trust** → **Integrations** → **Identity providers** → **Add new identity provider** → **One-time PIN**
3. **Workers & Pages** → `sabu6` → **Access** タブ → **Protect this Worker behind Access** を選び、**All traffic** を選びます。
   - この画面で選べる条件は「Cloudflare account」か「Email domain」だけです。いったん **Cloudflare account** で作成します。
   - Email domain(例: gmail.com)は選ばないでください。そのドメインのアドレスを持つ全員が入れてしまいます。
4. **Zero Trust** → **Access controls** → **Applications** で、作成されたアプリを編集します。
   - 許可の条件(ポリシー)を **Emails** にして、夫婦2人のメールアドレスを登録します。
   - ログイン方法に **One-time PIN** が含まれていることを確認します。
   - Session Duration は、選べる最長(1 month)にします。
   - **Additional settings** にある **Application Audience (AUD) Tag** を控えます(次の手順で使います)。
5. **Zero Trust** → **Access controls** → **Access settings** で、全体のセッション期間(global session duration)も最長(1 month)にします。

## 手順4: Worker に、ログインの検証用の値を設定する

**Workers & Pages** → `sabu6` → **Settings** → **Variables and Secrets** → **Add** で、次の2つを「テキスト」として追加し、**Deploy** を押します。

| 変数名 | 値 |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `https://<チーム名>.cloudflareaccess.com` |
| `ACCESS_AUD` | 手順3で控えた AUD タグ |

公開URLを開き、メールアドレスを入れて、届いたコードでログインできれば完了です。ホームにカードが9枚並びます。

## 手順5: iPhone での確認(第1段階の目的)

夫婦それぞれの iPhone で行います。結果(できた/できなかった、表示された文言)を Claude に伝えてください。

**A. スーパーアプリ本体**
1. Safari で公開URLを開き、ログインします。
2. 共有ボタン → **ホーム画面に追加**。名前が「SABU6」、アイコンが紺色に白い点9つ、になっているか確認します。
3. ホーム画面のアイコンから開きます。ログインを求められたら、ログインできるか確認します(このときの画面の様子を教えてください)。
4. 右上の **設定** → **通知を有効にする** → 許可します。
5. 「開く画面」で **ぴよログ** を選び、**テスト通知を送る** を押します。通知が届き、タップするとぴよログの画面が開くか確認します。

**B. ぴよログ単体のアイコン**
1. Safari で `公開URL/piyolog/` を開き、共有ボタン → **ホーム画面に追加**。名前が「ぴよログ」、アイコンが黄色に白い円、になっているか確認します。
2. そのアイコンから開いたとき、ログインをもう一度求められるかを確認します。
3. 左上の **‹ ホーム** を押したとき、アプリの中でホームに移るか、別の画面(ブラウザのような画面)が開くかを確認します。
4. 設定画面の「起動したアイコン」が piyolog になっていることを確認します。

**C. 通知の許可が1回で済むか**
- A で許可したあと、B のアイコンからは許可を求められないこと。テスト通知は A の許可だけで届くこと。

## 困ったとき

- 画面に「表示できません(503)」: 手順4の変数が未設定です。
- 画面に「表示できません(403)」: AUD タグかチーム名が違う可能性があります。
- 通知が届かない: 設定画面の「登録済みの端末」の「直近のエラー」を Claude に伝えてください。
- ログが見たいとき: **Workers & Pages** → `sabu6` → **Logs**。
