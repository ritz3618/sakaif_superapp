/** 表示する日の切り替え(前日・翌日のボタンと、カレンダー)。今日より先には進めない */
import { addDays } from "../../../core/shared/time";

const WEEKDAYS = "日月火水木金土";

export function dateLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
  return `${m}/${d}(${weekday})`;
}

export function DateNav({ date, today, onChange }: { date: string; today: string; onChange: (day: string) => void }) {
  const isToday = date === today;
  return (
    <nav className="piyolog-datenav" aria-label="表示する日">
      <button type="button" className="button--secondary button--small" onClick={() => onChange(addDays(date, -1))}>
        ‹ 前日
      </button>
      <label className="piyolog-datenav__date">
        <span>{isToday ? `今日 ${dateLabel(date)}` : dateLabel(date)}</span>
        <input
          type="date"
          value={date}
          max={today}
          aria-label="日付を選ぶ"
          onChange={(e) => e.currentTarget.value && onChange(e.currentTarget.value > today ? today : e.currentTarget.value)}
        />
      </label>
      {isToday ? (
        <button type="button" className="button--secondary button--small" disabled>
          翌日 ›
        </button>
      ) : (
        <span className="piyolog-datenav__right">
          <button type="button" className="button--secondary button--small" onClick={() => onChange(addDays(date, 1))}>
            翌日 ›
          </button>
          <button type="button" className="button--small" onClick={() => onChange(today)}>
            今日
          </button>
        </span>
      )}
    </nav>
  );
}
