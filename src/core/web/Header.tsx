import { useState } from "react";
import { Link } from "./router";

/**
 * 外部のアプリを開くボタン。同じ画面のままのリンクにする(ユニバーサルリンクなら、押すとそのアプリが立ち上がる)。
 * アイコンは、設定の「アイコン」で登録したもの → 宣言の icon → 名前の文字 の順に、使えるものを出す。
 */
function AppLink({ label, url, icons }: { label: string; url: string; icons: readonly string[] }) {
  const [failed, setFailed] = useState(0);
  const icon = icons[failed];
  return (
    <a href={url} className={icon ? "header-app-icon" : "header-app-button"} rel="noreferrer" aria-label={`${label}を開く`}>
      {icon ? (
        <img key={icon} src={icon} alt="" width={30} height={30} referrerPolicy="no-referrer" onError={() => setFailed((n) => n + 1)} />
      ) : (
        label
      )}
    </a>
  );
}

interface HeaderProps {
  title: string;
  /** true のとき、左に「ホーム」へ戻るボタンを出す(各機能の画面では必ず出す) */
  showHome?: boolean;
  /** 右側に「設定」へのリンクを出す */
  showSettings?: boolean;
  /** 「設定」のリンク先(省略時はアプリ全体の設定 /settings/) */
  settingsHref?: string;
  /** 右側に出す、外部のアプリを開くボタン(icons は、使いたい順のアイコンの URL) */
  appLink?: { label: string; url: string; icons: readonly string[] };
}

/** 共通ヘッダー。各機能の画面には、必ずホームへ戻るボタンが付く。 */
export function Header({ title, showHome = false, showSettings = false, settingsHref = "/settings/", appLink }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__side">
        {showHome && (
          <Link href="/" className="header-button" aria-label="ホームに戻る">
            <span aria-hidden="true">‹</span> ホーム
          </Link>
        )}
      </div>
      <h1 className="app-header__title">{title}</h1>
      <div className="app-header__side app-header__side--right">
        {appLink && <AppLink {...appLink} />}
        {showSettings && (
          <Link href={settingsHref} className="header-button" aria-label="設定">
            設定
          </Link>
        )}
      </div>
    </header>
  );
}
