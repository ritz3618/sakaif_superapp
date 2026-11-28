import { useState } from "react";
import { Link } from "./router";

/**
 * 外部のアプリを開くボタン。同じ画面のままのリンクにする(ユニバーサルリンクなら、押すとそのアプリが立ち上がる)。
 * アイコンがあればアイコンだけを出し、読めなかったときは名前の文字にする。
 */
function AppLink({ label, url, icon }: { label: string; url: string; icon?: string }) {
  const [broken, setBroken] = useState(false);
  const showIcon = icon && !broken;
  return (
    <a href={url} className={showIcon ? "header-app-icon" : "header-app-button"} rel="noreferrer" aria-label={`${label}を開く`}>
      {showIcon ? <img src={icon} alt="" width={30} height={30} referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : label}
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
  /** 右側に出す、外部のアプリを開くボタン */
  appLink?: { label: string; url: string; icon?: string };
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
