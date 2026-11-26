/** サーバーと画面がやり取りするデータの型(共通部分のAPI)。 */

export interface MeResponse {
  email: string;
  displayName: string | null;
}

export interface HomeCard {
  id: string;
  name: string;
  kind: "internal" | "external";
  /** internal: "/<機能ID>/" / external: 外部のURL */
  href: string;
  iconUrl: string;
  color: string;
  /** 機能が返す1行の要約(無ければ null) */
  summary: string | null;
}

export interface HomeResponse {
  appName: string;
  cards: HomeCard[];
}

export interface PushSubscriptionInfo {
  id: number;
  /** 送信先サービスのホスト名だけ(URL全体は返さない) */
  service: string;
  deviceLabel: string | null;
  /** 登録したときの開き方("app" または "browser"。古い登録は null) */
  appContext: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** この端末自身の登録か */
  isThisDevice: boolean;
}

export interface PushTestResult {
  sent: number;
  failed: number;
  removed: number;
  details: { service: string; status: number | null; error?: string }[];
}

export interface JobStatus {
  featureId: string;
  featureName: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface StatusResponse {
  lastCronAt: string | null;
  serverTime: string;
  jobs: JobStatus[];
}

export interface NotificationHistoryItem {
  id: number;
  featureName: string;
  type: string;
  title: string;
  body: string;
  /** "sent"(届けた)または "failed"(すべての端末で失敗) */
  status: string;
  sentCount: number;
  createdAt: string;
}

export interface HomeOrderItem {
  id: string;
  name: string;
  iconUrl: string;
}

export interface IconTargetInfo {
  id: string;
  name: string;
  /** "app" は本体 */
  isApp: boolean;
  iconUrl: string;
  /** "upload"(登録した画像)または "default"(既定のアイコン) */
  source: "upload" | "default";
}

export interface IconUploadRequest {
  /** 180×180 の PNG(base64) */
  png180: string;
  /** 192×192 の PNG(base64) */
  png192: string;
}
