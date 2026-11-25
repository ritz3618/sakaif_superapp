/** 定期実行の状態(最後に動いた時刻と、機能ごとの成功・失敗)。 */
import { useEffect, useState } from "react";
import type { StatusResponse } from "../../shared/api-types";
import { apiJson } from "../api";
import { formatJst, Row } from "./common";

export function StatusPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    apiJson<StatusResponse>("/api/core/status").then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <section className="panel">
      <h2>定期実行</h2>
      <dl className="kv">
        <Row label="最後に動いた時刻" value={status ? formatJst(status.lastCronAt) : "確認中…"} />
        {status?.jobs.map((job) => (
          <Row
            key={job.featureId}
            label={job.featureName}
            value={
              job.consecutiveFailures > 0
                ? `${job.consecutiveFailures}回続けて失敗(最後のエラー: ${job.lastError ?? "不明"})`
                : `正常(最後の成功 ${formatJst(job.lastSuccessAt)})`
            }
          />
        ))}
      </dl>
      {status && status.jobs.length === 0 && <p className="note">定期実行する機能は、まだありません。</p>}
    </section>
  );
}
