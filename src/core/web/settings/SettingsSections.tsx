/**
 * 宣言された設定項目を、名前空間(共通・機能ごと)の欄に分けて自動で並べる。
 * - アプリ全体の設定画面(only 省略): 共通の設定を表示し、機能ごとの設定は、各機能の設定画面へのリンクにする。
 * - 機能の設定画面(only = 機能ID): その機能の設定だけを表示する。項目に group があれば、小見出しで分ける。
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { NAMESPACE_CORE, type SettingSection } from "../../shared/settings";
import { featureSettingsPath } from "../../shared/feature";
import { apiJson } from "../api";
import { Link } from "../router";
import { errorMessage } from "./common";
import { SettingField } from "./SettingField";

function useSections() {
  const [sections, setSections] = useState<SettingSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiJson<SettingSection[]>("/api/core/settings")
      .then(setSections)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  return { sections, error, load };
}

function SectionItems({ section, onSaved }: { section: SettingSection; onSaved: () => void }) {
  let lastGroup: string | undefined;
  return (
    <>
      {section.items.map((item) => {
        const group = item.def.group;
        const heading = group && group !== lastGroup ? <h3 className="settings-group">{group}</h3> : null;
        lastGroup = group;
        return (
          <Fragment key={`${item.namespace}.${item.def.key}`}>
            {heading}
            <SettingField item={item} onSaved={onSaved} />
          </Fragment>
        );
      })}
    </>
  );
}

export function SettingsSections({ only }: { only?: string }) {
  const { sections, error, load } = useSections();
  if (error) return <p className="message message--error">{error}</p>;
  if (!sections) return <p className="note">設定を読み込み中…</p>;

  if (only) {
    const section = sections.find((s) => s.namespace === only);
    if (!section) return <p className="note">この機能には設定がありません。</p>;
    return (
      <section className="panel">
        <SectionItems section={section} onSaved={load} />
      </section>
    );
  }

  const core = sections.find((s) => s.namespace === NAMESPACE_CORE);
  const features = sections.filter((s) => s.namespace !== NAMESPACE_CORE);
  return (
    <>
      {core && (
        <section className="panel">
          <h2>共通の設定</h2>
          <SectionItems section={core} onSaved={load} />
        </section>
      )}
      {features.length > 0 && (
        <section className="panel">
          <h2>機能ごとの設定</h2>
          <ul className="link-list">
            {features.map((s) => (
              <li key={s.namespace}>
                <Link href={featureSettingsPath(s.namespace)}>{s.title} ›</Link>
                <span className="note">{s.items.length}項目(各機能の画面の右上の「設定」からも開けます)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
