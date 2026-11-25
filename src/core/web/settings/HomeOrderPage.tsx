/** ホームの並び順の画面(自分だけの設定)。上下のボタンで並べ替えて、保存する。 */
import { useEffect, useState } from "react";
import type { HomeOrderItem } from "../../shared/api-types";
import { apiJson } from "../api";
import { Header } from "../Header";
import { errorMessage } from "./common";

export function HomeOrderPage() {
  const [items, setItems] = useState<HomeOrderItem[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiJson<{ items: HomeOrderItem[] }>("/api/core/home/order")
      .then((r) => {
        setItems(r.items);
        setSaved(r.items.map((i) => i.id));
      })
      .catch((e: unknown) => setMessage(errorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const move = (index: number, delta: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setItems(next);
    setMessage(null);
  };

  const save = async (order: string[] | null, done: string) => {
    setBusy(true);
    try {
      await apiJson("/api/core/home/order", { method: "PUT", body: JSON.stringify({ order }) });
      setMessage(done);
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const changed = items !== null && items.map((i) => i.id).join(",") !== saved.join(",");
  return (
    <div className="page">
      <Header title="ホームの並び順" showHome />
      <main className="settings">
        <p className="note">自分のホームだけに反映されます。</p>
        <section className="panel">
          <ol className="order-list">
            {items?.map((item, index) => (
              <li key={item.id}>
                <img src={item.iconUrl} alt="" width={36} height={36} />
                <span className="order-list__name">{item.name}</span>
                <button
                  type="button"
                  className="button--secondary button--small"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`${item.name}を上へ`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button--secondary button--small"
                  disabled={busy || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`${item.name}を下へ`}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <div className="buttons">
            <button type="button" disabled={busy || !changed} onClick={() => items && save(items.map((i) => i.id), "保存しました。")}>
              保存
            </button>
            <button type="button" className="button--secondary" disabled={busy} onClick={() => save(null, "既定の順に戻しました。")}>
              既定の順に戻す
            </button>
          </div>
          {message && <p className="message">{message}</p>}
        </section>
      </main>
    </div>
  );
}
