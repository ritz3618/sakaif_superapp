/**
 * 通知の入口。機能は「誰に、何を載せて送るか」だけを渡す。
 *
 * 第1段階: 宛先の解決と送信、失効した宛先の削除まで。
 * 第2段階で、ここに次を足す(機能側の呼び方は変えない):
 *   通知の種類(type)、重複送信の防止(dedupeKey)、禁止時間帯、ユーザーごとのオン・オフ、送信履歴。
 */
import { sendToSubscriptions, subscriptionsForUsers, type NotificationPayload, type SendResult } from "./push/sender";

export interface NotifyRequest extends NotificationPayload {
  /** "all" は登録済みの全員。ユーザーIDの配列で個別に指定もできる。 */
  to: "all" | readonly number[];
}

export async function notify(db: D1Database, request: NotifyRequest): Promise<SendResult[]> {
  const { to, ...payload } = request;
  const subscriptions = await subscriptionsForUsers(db, to);
  return sendToSubscriptions(db, subscriptions, payload);
}
