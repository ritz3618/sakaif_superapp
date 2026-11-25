/** 自分に送られた通知の履歴(新しい順)。 */
import { useEffect, useState } from "react";
import type { NotificationHistoryItem } from "../../shared/api-types";
import { apiJson } from "../api";
import { errorMessage, formatJst } from "./common";

export function HistoryPanel() {
  const [items, setItems] = useState<NotificationHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    apiJson<NotificationHistoryItem[]>(`/api/core/notifications/history?limit=${limit}`)
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [limit]);

  return (
    <section className="panel">
      <h2>通知の履歴</h2>
      <p className="note">自分に送られた通知です。通知を避ける時間帯の間に保留したものは、送ったときに記録されます。</p>
      {error && <p className="message message--error">{error}</p>}
      {items?.length === 0 && <p className="note">まだありません。</p>}
      <ul className="history-list">
        {items?.map((item) => (
          <li key={item.id}>
            <span className="history-list__meta">
              {formatJst(item.createdAt)} / {item.featureName}
              {item.status !== "sent" && <span className="badge badge--danger">届かず</span>}
            </span>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </li>
        ))}
      </ul>
      {items && items.length >= limit && limit < 100 && (
        <button type="button" className="button--secondary" onClick={() => setLimit(100)}>
          もっと見る
        </button>
      )}
    </section>
  );
}
