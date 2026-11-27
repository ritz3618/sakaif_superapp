import { Link } from "./router";

interface HeaderProps {
  title: string;
  /** true のとき、左に「ホーム」へ戻るボタンを出す(各機能の画面では必ず出す) */
  showHome?: boolean;
  /** 右側に「設定」へのリンクを出す */
  showSettings?: boolean;
  /** 「設定」のリンク先(省略時はアプリ全体の設定 /settings/) */
  settingsHref?: string;
}

/** 共通ヘッダー。各機能の画面には、必ずホームへ戻るボタンが付く。 */
export function Header({ title, showHome = false, showSettings = false, settingsHref = "/settings/" }: HeaderProps) {
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
        {showSettings && (
          <Link href={settingsHref} className="header-button" aria-label="設定">
            設定
          </Link>
        )}
      </div>
    </header>
  );
}
