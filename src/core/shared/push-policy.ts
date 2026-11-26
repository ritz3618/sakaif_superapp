/**
 * 通知の宛先を登録してよい開き方の決まり(サーバーと画面の両方で使う)。
 *
 * iPhone では、ホーム画面に追加したアイコンごとに別のアプリとして扱われ、通知の許可も別々になる。
 * 本体と機能単体の両方で登録すると、同じ通知が2通届いてしまう(2026-11-25 実機で確認)。
 * そのため、登録はスーパーアプリ本体(またはブラウザ)からだけ受け付ける。
 */
import { APP_INFO } from "./app";

/** ブラウザ(ホーム画面のアイコン以外)から開いているときの値 */
export const BROWSER_CONTEXT = "browser";

/** appContext は、起動したアイコン(本体なら "app"、機能単体なら その機能ID)、またはブラウザなら "browser"。 */
export function canRegisterPush(appContext: string): boolean {
  return appContext === APP_INFO.id || appContext === BROWSER_CONTEXT;
}
