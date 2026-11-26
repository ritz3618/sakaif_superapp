/**
 * スーパーアプリのホーム。機能の宣言から自動でカードが並ぶ。
 * カードは、数が増えても1画面に収まるように、列数と大きさを自動で調整する。
 */
import { useEffect, useState } from "react";
import type { HomeCard, HomeResponse } from "../shared/api-types";
import { apiJson } from "./api";
import { Header } from "./Header";
import { Link } from "./router";

/** カードの数から列数を決める(9枚までは3列、16枚までは4列、それ以上は5列で、収まらなければスクロール)。 */
export function gridColumns(count: number): number {
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}

function Card({ card }: { card: HomeCard }) {
  const content = (
    <>
      <img className="card__icon" src={card.iconUrl} alt="" width={102} height={102} />
      <span className="card__name">{card.name}</span>
      {card.summary && <span className="card__summary">{card.summary}</span>}
    </>
  );
  if (card.kind === "external") {
    return (
      <a className="card" href={card.href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return (
    <Link className="card" href={card.href}>
      {content}
    </Link>
  );
}

export function Home({ appName }: { appName: string }) {
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<HomeResponse>("/api/core/home")
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const count = data?.cards.length ?? 0;
  const columns = gridColumns(count);
  const rows = Math.max(1, Math.ceil(count / columns));
  const scroll = count > 25;

  return (
    <div className="page page--home">
      <Header title={data?.appName ?? appName} showSettings />
      <main className="home">
        {error && <p className="message message--error">{error}</p>}
        {!data && !error && <p className="message">読み込み中…</p>}
        {data && (
          <div
            className={`home-grid${scroll ? " home-grid--scroll" : ""}`}
            style={{ ["--cols" as string]: columns, ["--rows" as string]: rows }}
          >
            {data.cards.map((card) => (
              <Card key={card.id} card={card} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
