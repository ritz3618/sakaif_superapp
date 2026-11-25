/** 宣言された設定項目を、名前空間(共通・機能ごと)の欄に分けて自動で並べる。 */
import { useCallback, useEffect, useState } from "react";
import type { SettingSection } from "../../shared/settings";
import { apiJson } from "../api";
import { errorMessage } from "./common";
import { SettingField } from "./SettingField";

export function SettingsSections() {
  const [sections, setSections] = useState<SettingSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<SettingSection[]>("/api/core/settings")
      .then(setSections)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  if (error) return <p className="message message--error">{error}</p>;
  if (!sections) return <p className="note">設定を読み込み中…</p>;
  return (
    <>
      {sections.map((section) => (
        <section className="panel" key={section.namespace}>
          <h2>{section.namespace === "core" ? "共通の設定" : section.title}</h2>
          {section.items.map((item) => (
            <SettingField key={`${item.namespace}.${item.def.key}`} item={item} onSaved={load} />
          ))}
        </section>
      ))}
    </>
  );
}
