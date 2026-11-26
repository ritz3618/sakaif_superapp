/**
 * データの管理(/<機能ID>/data/)。
 * - 保存している記録の件数と期間
 * - CSV の書き出し: iPhone のアプリの中で開くと戻れなくなるため、ファイルを作ってから「共有」で渡す
 *   (共有の画面で「"ファイル"に保存」などを選ぶ)。共有が使えない環境では、ダウンロードにする。
 * - 過去の記録の取り込み: ぴよログのアプリで書き出した、月ごとのテキストを選ぶ。
 *   画面で読み取って中身を確認してから、数日分ずつサーバーに送る(1回の処理を軽くするため)。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, FileButton, Link, Note, Panel, type FeatureScreenProps } from "../../../core/web/feature-api";
import { jstDate, jstTime } from "../../../core/shared/time";
import type { ImportResult, PiyologDataInfo } from "../shared/api";
import { countByLabel, parseMonthlyText, splitByDays, TextImportError, type ParsedMonth } from "../shared/text-import";
import { shortDate, timeOf } from "./time";

const dateOf = (iso: string | null) => (iso ? jstDate(new Date(iso)).replace(/-/g, "/") : "—");

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CsvPanel({ apiFetch, info }: Pick<FeatureScreenProps, "apiFetch"> & { info: PiyologDataInfo }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const prepare = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch("/export.csv");
      const blob = await res.blob();
      const name = `ikuji-log-${jstDate(new Date()).replace(/-/g, "")}.csv`;
      setFile(new File([blob], name, { type: "text/csv" }));
    } catch (e) {
      setMessage({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file) return;
    setMessage(null);
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
      } catch (e) {
        // 共有の画面を閉じただけ(AbortError)なら、何も出さない
        if (!(e instanceof DOMException && e.name === "AbortError")) setMessage({ text: errorText(e), error: true });
      }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <Panel title="CSVで書き出す">
      <Note>
        {`保存しているすべての期間の記録が入ります` +
          (info.stored.count > 0 ? `(${dateOf(info.stored.earliestAt)}〜${dateOf(info.stored.latestAt)}、${info.stored.count}件)` : "") +
          "。日時は日本時間です。"}
      </Note>
      {!file ? (
        <Button disabled={busy || info.stored.count === 0} onClick={prepare}>
          {busy ? "作成中…" : "CSVを作る"}
        </Button>
      ) : (
        <>
          <Note>
            {file.name} を作りました({Math.max(1, Math.round(file.size / 1024))}KB)。下のボタンを押すと共有の画面が開きます。iPhoneに保存するときは「"ファイル"に保存」を選んでください。
          </Note>
          <div className="piyolog-buttons">
            <Button onClick={save}>保存・共有する</Button>
            <Button variant="secondary" onClick={() => setFile(null)}>
              作り直す
            </Button>
          </div>
        </>
      )}
      {message && <Note tone={message.error ? "error" : undefined}>{message.text}</Note>}
    </Panel>
  );
}

interface Preview {
  text: string;
  parsed: ParsedMonth;
  fileName: string;
  /** 取り込みの対象(フィードで取得している期間より前)の件数 */
  target: number;
}

function ImportPanel({
  apiFetch,
  info,
  onDone,
}: Pick<FeatureScreenProps, "apiFetch"> & { info: PiyologDataInfo; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // フィードの範囲が分からない(フィードを使っていない)ときは、今より前をすべて対象にする
  const cutoff = info.importCutoff ? Date.parse(info.importCutoff) : Date.now();

  const select = async (file: File) => {
    setPreview(null);
    setResult(null);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseMonthlyText(text);
      const target = parsed.records.filter((r) => Date.parse(r.at) < cutoff).length;
      setPreview({ text, parsed, fileName: file.name, target });
    } catch (e) {
      setError(e instanceof TextImportError ? e.message : `ファイルを読めませんでした: ${errorText(e)}`);
    }
  };

  const run = async () => {
    if (!preview) return;
    setError(null);
    const chunks = splitByDays(preview.text, 7);
    const total: ImportResult = { firstDay: "", lastDay: "", received: 0, matched: 0, written: 0, deleted: 0, ignored: 0 };
    try {
      for (let i = 0; i < chunks.length; i++) {
        setProgress(`取り込み中… ${i + 1}/${chunks.length}`);
        const res = await apiFetch("/import", { method: "POST", body: JSON.stringify({ text: chunks[i] }) });
        const part = (await res.json()) as ImportResult;
        total.firstDay ||= part.firstDay;
        total.lastDay = part.lastDay;
        total.received += part.received;
        total.matched += part.matched;
        total.written += part.written;
        total.deleted += part.deleted;
        total.ignored += part.ignored;
      }
      setResult(total);
      setPreview(null);
      onDone();
    } catch (e) {
      setError(`途中で止まりました(もう一度取り込むと、続きから正しく反映されます): ${errorText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  const { parsed } = preview ?? {};
  const counts = parsed ? countByLabel(parsed.records).slice(0, 8) : [];

  return (
    <Panel title="過去の記録を取り込む">
      <Note>
        ぴよログのアプリで書き出した「月ごとのテキスト」(1か月分のファイル)を選んでください。同じ月を何度取り込んでも、記録が重なることはありません。
      </Note>
      {info.importCutoff && (
        <Note>
          フィードで取得している期間({dateOf(info.importCutoff)} {jstTime(new Date(info.importCutoff))}以降)は、フィードの記録を使うため、取り込みません。
        </Note>
      )}
      <FileButton accept=".txt,text/plain" onSelect={select} disabled={progress !== null}>
        テキストファイルを選ぶ
      </FileButton>

      {preview && parsed && (
        <div className="piyolog-preview">
          <h3>
            {parsed.year}年{parsed.month}月({parsed.days.length}日分)
          </h3>
          <Note>
            {preview.fileName}: 記録 {parsed.records.length}件
            {parsed.days.length > 0 && `(${shortDate(parsed.days[0]!)}〜${shortDate(parsed.days.at(-1)!)})`}
          </Note>
          <ul className="piyolog-counts">
            {counts.map((c) => (
              <li key={c.label}>
                {c.label} {c.count}件
              </li>
            ))}
          </ul>
          {preview.target < parsed.records.length && (
            <Note>
              このうち {parsed.records.length - preview.target}件は、フィードで取得している期間のため取り込みません。
            </Note>
          )}
          {parsed.skipped.length > 0 && (
            <Note tone="warn">
              読めなかった行が {parsed.skipped.length}行あります(取り込まれません)。例: {parsed.skipped[0]!.line}行目
            </Note>
          )}
          <div className="piyolog-buttons">
            <Button disabled={progress !== null || preview.target === 0} onClick={run}>
              {progress ?? `${preview.target}件を取り込む`}
            </Button>
            <Button variant="secondary" disabled={progress !== null} onClick={() => setPreview(null)}>
              やめる
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Note>
          {`取り込みました(${shortDate(result.firstDay)}〜${shortDate(result.lastDay)}): 対象 ${result.received}件のうち、` +
            `フィードの記録と一致 ${result.matched}件、新しく追加・更新 ${result.written}件` +
            (result.deleted > 0 ? `、前回の取り込みから無くなった記録 ${result.deleted}件を削除` : "") +
            "。"}
        </Note>
      )}
      {error && <Note tone="error">{error}</Note>}
    </Panel>
  );
}

export default function DataPage({ apiFetch, feature }: FeatureScreenProps) {
  const [info, setInfo] = useState<PiyologDataInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/data-info");
      setInfo((await res.json()) as PiyologDataInfo);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="piyolog-screen">
      <Link href={`/${feature.id}/`} className="piyolog-back">
        ‹ 育児ログに戻る
      </Link>
      {error && <Note tone="error">{error}</Note>}
      {!info && !error && <Note>読み込み中…</Note>}
      {info && (
        <>
          <Panel title="保存している記録">
            <p className="piyolog-stored">
              {info.stored.count > 0
                ? `${info.stored.count}件(${dateOf(info.stored.earliestAt)}〜${dateOf(info.stored.latestAt)})`
                : "まだありません"}
            </p>
            <Note>
              記録は、このアプリのデータベースに残り続けます。フィードURLの期限(作成から約90日)は、新しい記録を取りに行けなくなる日で、期限が来ても保存した記録は消えません。
            </Note>
            {info.expiry && (
              <Note tone={info.expiry.daysLeft <= 14 ? "warn" : undefined}>
                フィードURLの期限の目安: {info.expiry.expiresOn.replace(/-/g, "/")}
                {info.expiry.daysLeft >= 0 ? `(あと${info.expiry.daysLeft}日)` : "(過ぎています)"}。期限の前に、ぴよログで新しいフィードを作り、設定画面でURLを入れ替えてください。
              </Note>
            )}
            {info.stored.latestAt && <Note>最新の記録: {timeOf(info.stored.latestAt)}</Note>}
          </Panel>
          <ImportPanel apiFetch={apiFetch} info={info} onDone={load} />
          <CsvPanel key={info.stored.count} apiFetch={apiFetch} info={info} />
        </>
      )}
    </div>
  );
}
