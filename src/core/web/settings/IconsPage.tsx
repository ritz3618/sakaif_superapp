/** アイコンの設定画面。本体と各機能のアイコンに、好きな画像を登録できる。 */
import { useCallback, useEffect, useState } from "react";
import type { IconTargetInfo } from "../../shared/api-types";
import { apiJson } from "../api";
import { Header } from "../Header";
import { errorMessage } from "./common";
import { IconEditor } from "./IconEditor";

export function IconsPage() {
  const [targets, setTargets] = useState<IconTargetInfo[] | null>(null);
  const [editing, setEditing] = useState<IconTargetInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<IconTargetInfo[]>("/api/core/icons")
      .then(setTargets)
      .catch((e: unknown) => setMessage(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const reset = async (target: IconTargetInfo) => {
    if (!window.confirm(`「${target.name}」のアイコンを、既定のものに戻しますか?`)) return;
    try {
      await apiJson(`/api/core/icons/${target.id}`, { method: "DELETE" });
      setMessage(`「${target.name}」のアイコンを既定に戻しました。`);
      load();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <div className="page">
      <Header title="アイコン" showHome />
      <main className="settings">
        <p className="note">
          iPhone のホーム画面に追加済みのアイコンは、追加したときの画像のままです。変えたあとは、ホーム画面のアイコンを一度削除して、追加し直してください。
        </p>
        {message && <p className="message">{message}</p>}
        {editing && (
          <section className="panel">
            <IconEditor
              target={editing}
              onClose={(saved) => {
                if (saved) setMessage(`「${editing.name}」のアイコンを保存しました。`);
                setEditing(null);
                load();
              }}
            />
          </section>
        )}
        <section className="panel">
          <ul className="icon-list">
            {targets?.map((t) => (
              <li key={t.id}>
                <img src={t.iconUrl} alt="" width={48} height={48} />
                <span className="icon-list__name">
                  {t.name}
                  {t.isApp && <span className="note">(本体)</span>}
                  <span className="note">{t.source === "upload" ? "登録した画像" : "既定のアイコン"}</span>
                </span>
                <span className="icon-list__buttons">
                  <button type="button" className="button--small" onClick={() => setEditing(t)}>
                    変える
                  </button>
                  {t.source === "upload" && (
                    <button type="button" className="button--secondary button--small" onClick={() => reset(t)}>
                      既定に戻す
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
