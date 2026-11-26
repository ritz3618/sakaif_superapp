/**
 * ぴよログのデータフィードの取得と検査(公式のデータ仕様 v1 に従う)。
 * - フィードURLは認証情報なので、エラーメッセージやログに URL を絶対に含めない。
 * - 正常な応答(200 で、形式が正しい)のときだけ、データとして扱う。エラーを「0件」とみなさない(公式の注意)。
 */

export const FEED_URL_PATTERN = /^https:\/\/feed\.piyolog\.com\/v1\/feed\/[^/?#\s]+\/[^/?#\s]+\/[^/?#\s]+$/;
const SUPPORTED_SCHEMA_VERSION = 1;

export interface FeedRecord {
  event_id: string;
  datetime: string;
  type: string;
  value?: { value?: number; unit?: string; left?: number; right?: number };
  memo?: string;
  [key: string]: unknown;
}

export interface Feed {
  generatedAt: string;
  /** この時刻の記録は含む */
  from: string;
  /** この時刻の記録は含まない */
  to: string;
  records: FeedRecord[];
  /** 形式が正しくなく、読み飛ばした記録の数 */
  skipped: number;
}

export type FeedErrorKind = "config" | "unavailable" | "rate_limited" | "server" | "network" | "format";

export class FeedError extends Error {
  constructor(
    message: string,
    readonly kind: FeedErrorKind,
  ) {
    super(message);
    this.name = "FeedError";
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** 応答の JSON を検査して、扱いやすい形にする。 */
export function parseFeed(json: unknown): Feed {
  const body = json as {
    schema_version?: unknown;
    generated_at?: unknown;
    range?: { from?: unknown; to?: unknown };
    records?: unknown;
  };
  if (!body || typeof body !== "object") throw new FeedError("フィードの形式が正しくありません", "format");
  if (body.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    // 未対応の版は、そのまま処理しない(公式の注意)
    throw new FeedError(`フィードのデータ仕様の版(${String(body.schema_version)})に対応していません`, "format");
  }
  if (!isIsoDate(body.generated_at) || !isIsoDate(body.range?.from) || !isIsoDate(body.range?.to)) {
    throw new FeedError("フィードの日時の形式が正しくありません", "format");
  }
  if (!Array.isArray(body.records)) throw new FeedError("フィードに記録の一覧がありません", "format");

  const records: FeedRecord[] = [];
  let skipped = 0;
  for (const item of body.records as unknown[]) {
    const r = item as Partial<FeedRecord>;
    if (r && typeof r.event_id === "string" && r.event_id && typeof r.type === "string" && isIsoDate(r.datetime)) {
      records.push(r as FeedRecord);
    } else {
      skipped++;
    }
  }
  return {
    generatedAt: new Date(body.generated_at).toISOString(),
    from: new Date(body.range!.from as string).toISOString(),
    to: new Date(body.range!.to as string).toISOString(),
    records,
    skipped,
  };
}

/** フィードを取得する。失敗したら FeedError を投げる。 */
export async function fetchFeed(url: string, fetcher: typeof fetch = fetch): Promise<Feed> {
  if (!FEED_URL_PATTERN.test(url)) {
    throw new FeedError("フィードURLの形式が正しくありません(https://feed.piyolog.com/v1/feed/… の形)", "config");
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "sabu6-family-app/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FeedError("フィードに接続できませんでした", "network");
  }
  if (response.status === 200) {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new FeedError("フィードの応答を読めませんでした", "format");
    }
    return parseFeed(json);
  }
  let code = "";
  try {
    code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? "";
  } catch {
    // エラーの本文が JSON でなくても、状態コードで判断する
  }
  const detail = code ? `${response.status} ${code}` : String(response.status);
  if (response.status === 404) {
    throw new FeedError(
      `フィードが見つかりません(${detail})。期限切れ・失効・URLの誤りの可能性があります`,
      "unavailable",
    );
  }
  if (response.status === 429) throw new FeedError(`取得の回数が多すぎます(${detail})`, "rate_limited");
  if (response.status >= 500) throw new FeedError(`ぴよログのサーバーで一時的なエラーが起きました(${detail})`, "server");
  throw new FeedError(`フィードを取得できませんでした(${detail})`, "unavailable");
}
