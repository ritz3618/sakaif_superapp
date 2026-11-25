/**
 * 1つの設定項目の入力欄。宣言の種類(type)に応じて、自動で入力方法が決まる。
 *   boolean    → スイッチ(押すとすぐ保存)
 *   minutes    → 「時間」「分」を選ぶ(選ぶとすぐ保存)
 *   timeRanges → 開始・終了の時刻の行を、追加・削除して「保存」
 *   date       → 日付を選んで「保存」/「クリア」
 *   text       → 文字を入れて「保存」
 *   secret     → 「設定済み」かどうかだけ表示。入力欄は伏せ字で、保存後は中身を表示しない
 */
import { useState } from "react";
import {
  validateSettingValue,
  type SecretStatus,
  type SettingItem,
  type SettingValue,
  type TimeRange,
} from "../../shared/settings";
import { apiJson } from "../api";
import { errorMessage, formatJst } from "./common";

async function save(item: SettingItem, value: SettingValue): Promise<void> {
  const checked = validateSettingValue(item.def, value);
  if (!checked.ok) throw new Error(checked.error);
  await apiJson("/api/core/settings", {
    method: "PUT",
    body: JSON.stringify({ namespace: item.namespace, key: item.def.key, value: checked.value }),
  });
}

export function SettingField({ item, onSaved }: { item: SettingItem; onSaved: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (value: SettingValue, done = "保存しました") => {
    setBusy(true);
    setMessage(null);
    try {
      await save(item, value);
      setMessage(done);
      onSaved();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const { def } = item;
  return (
    <div className="setting">
      <div className="setting__head">
        <span className="setting__label">{def.label}</span>
        {def.type === "boolean" && (
          <label className="switch">
            <input
              type="checkbox"
              checked={item.value === true}
              disabled={busy}
              onChange={(e) => run(e.target.checked, e.target.checked ? "オンにしました" : "オフにしました")}
            />
            <span className="switch__track" aria-hidden="true" />
            <span className="visually-hidden">{def.label}</span>
          </label>
        )}
      </div>
      {def.description && <p className="note">{def.description}</p>}
      {def.type === "minutes" && (
        <MinutesInput value={item.value as number} max={def.max} disabled={busy} onChange={(v) => run(v)} />
      )}
      {def.type === "timeRanges" && (
        <TimeRangesInput key={item.updatedAt ?? "default"} value={item.value as TimeRange[]} disabled={busy} onSave={(v) => run(v)} />
      )}
      {def.type === "date" && <DateInput key={item.updatedAt ?? "default"} value={item.value as string | null} disabled={busy} onSave={(v) => run(v)} />}
      {def.type === "text" && <TextInput key={item.updatedAt ?? "default"} value={item.value as string} disabled={busy} onSave={(v) => run(v)} />}
      {def.type === "secret" && (
        <SecretInput status={item.value as SecretStatus} disabled={busy} onSave={(v) => run(v, v === null ? "削除しました" : "保存しました")} />
      )}
      {message && <p className="setting__message">{message}</p>}
    </div>
  );
}

function MinutesInput({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max?: number;
  disabled: boolean;
  onChange: (minutes: number) => void;
}) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  const maxHours = Math.max(1, Math.floor((max ?? 24 * 60) / 60));
  const minuteOptions = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!minuteOptions.includes(minutes)) minuteOptions.push(minutes);
  minuteOptions.sort((a, b) => a - b);
  return (
    <div className="setting__inputs">
      <select value={hours} disabled={disabled} onChange={(e) => onChange(Number(e.target.value) * 60 + minutes)} aria-label="時間">
        {Array.from({ length: maxHours + 1 }, (_, h) => (
          <option key={h} value={h}>
            {h}時間
          </option>
        ))}
      </select>
      <select value={minutes} disabled={disabled} onChange={(e) => onChange(hours * 60 + Number(e.target.value))} aria-label="分">
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </div>
  );
}

function TimeRangesInput({
  value,
  disabled,
  onSave,
}: {
  value: TimeRange[];
  disabled: boolean;
  onSave: (ranges: TimeRange[]) => void;
}) {
  const [ranges, setRanges] = useState<TimeRange[]>(value);
  const changed = JSON.stringify(ranges) !== JSON.stringify(value);
  const update = (index: number, patch: Partial<TimeRange>) =>
    setRanges(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <div>
      {ranges.length === 0 && <p className="note">設定されていません。</p>}
      {ranges.map((range, index) => (
        <div className="time-range" key={index}>
          <input type="time" value={range.start} disabled={disabled} onChange={(e) => update(index, { start: e.target.value })} aria-label="開始" />
          <span>〜</span>
          <input type="time" value={range.end} disabled={disabled} onChange={(e) => update(index, { end: e.target.value })} aria-label="終了" />
          {range.end <= range.start && range.end !== range.start && <span className="time-range__note">翌日</span>}
          <button type="button" className="button--secondary button--small" disabled={disabled} onClick={() => setRanges(ranges.filter((_, i) => i !== index))}>
            削除
          </button>
        </div>
      ))}
      <div className="buttons">
        <button type="button" className="button--secondary" disabled={disabled} onClick={() => setRanges([...ranges, { start: "22:00", end: "06:00" }])}>
          時間帯を追加
        </button>
        <button type="button" disabled={disabled || !changed} onClick={() => onSave(ranges)}>
          保存
        </button>
      </div>
    </div>
  );
}

function DateInput({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string | null) => void }) {
  const [date, setDate] = useState(value ?? "");
  return (
    <div className="setting__inputs">
      <input type="date" value={date} disabled={disabled} onChange={(e) => setDate(e.target.value)} />
      <button type="button" disabled={disabled || date === (value ?? "") || !date} onClick={() => onSave(date)}>
        保存
      </button>
      {value && (
        <button type="button" className="button--secondary" disabled={disabled} onClick={() => { setDate(""); onSave(null); }}>
          クリア
        </button>
      )}
    </div>
  );
}

function TextInput({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="setting__inputs">
      <input type="text" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      <button type="button" disabled={disabled || text === value} onClick={() => onSave(text)}>
        保存
      </button>
    </div>
  );
}

function SecretInput({
  status,
  disabled,
  onSave,
}: {
  status: SecretStatus;
  disabled: boolean;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <div>
      <p className="setting__status">
        {status.isSet ? `設定済み(${formatJst(status.updatedAt)} 更新)` : "未設定"}
        <span className="note"> 保存した値は、画面には表示しません。</span>
      </p>
      {editing ? (
        <div className="setting__inputs">
          <input
            type="password"
            autoComplete="off"
            value={text}
            disabled={disabled}
            placeholder="値を貼り付け"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" disabled={disabled || !text.trim()} onClick={() => { onSave(text); setText(""); setEditing(false); }}>
            保存
          </button>
          <button type="button" className="button--secondary" disabled={disabled} onClick={() => { setText(""); setEditing(false); }}>
            やめる
          </button>
        </div>
      ) : (
        <div className="buttons">
          <button type="button" disabled={disabled} onClick={() => setEditing(true)}>
            {status.isSet ? "入れ直す" : "入力する"}
          </button>
          {status.isSet && (
            <button
              type="button"
              className="button--secondary"
              disabled={disabled}
              onClick={() => window.confirm("保存した値を削除しますか?") && onSave(null)}
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
