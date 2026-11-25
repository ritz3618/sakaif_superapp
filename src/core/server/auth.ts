/**
 * ログインとユーザー識別。
 *
 * 本番(AUTH_MODE=access): Cloudflare Access が付けるトークン(Cf-Access-Jwt-Assertion)を、
 * 公式の方法(jose)で検証し、メールアドレスを取り出す。
 * 静的アセットを持つ Worker では ctx.access が使えない(公式ドキュメント)ため、自分で検証する。
 *
 * ログイン方式を変える(または無くす)ときは、この authenticate() だけを差し替える。
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, User } from "./env";

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500 | 503; reason: string };

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeTeamDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function isLocalhost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const mode = env.AUTH_MODE ?? "access";

  if (mode === "dev") {
    // 設定ミスで本番がログインなしにならないよう、dev モードは localhost からのアクセスに限る。
    if (!isLocalhost(request)) {
      return { ok: false, status: 403, reason: "dev モードは localhost でのみ使えます" };
    }
    const email = env.DEV_USER_EMAIL?.trim().toLowerCase();
    if (!email) return { ok: false, status: 500, reason: "DEV_USER_EMAIL が設定されていません" };
    return { ok: true, email };
  }

  if (mode !== "access") {
    return { ok: false, status: 500, reason: `AUTH_MODE "${mode}" は未対応です` };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return {
      ok: false,
      status: 503,
      reason: "ACCESS_TEAM_DOMAIN と ACCESS_AUD が未設定です(Cloudflare の Worker の変数で設定してください)",
    };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { ok: false, status: 401, reason: "Cloudflare Access のトークンがありません" };
  }

  const team = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD.trim() });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) return { ok: false, status: 403, reason: "トークンにメールアドレスが含まれていません" };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 403, reason: "Cloudflare Access のトークンを検証できませんでした" };
  }
}

/** 最終アクセス時刻の更新は、書き込み回数を抑えるため10分に1回まで。 */
const LAST_SEEN_INTERVAL_MS = 10 * 60 * 1000;
const userCache = new Map<string, { user: User; lastSeenWrittenAt: number }>();

/** メールアドレスに対応するユーザーを返す。初めてのメールアドレスなら自動で登録する。 */
export async function getOrCreateUser(db: D1Database, email: string, now: Date = new Date()): Promise<User> {
  const cached = userCache.get(email);
  if (cached && now.getTime() - cached.lastSeenWrittenAt < LAST_SEEN_INTERVAL_MS) {
    return cached.user;
  }

  const iso = now.toISOString();
  await db
    .prepare(
      "INSERT INTO core_users (email, created_at, last_seen_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at",
    )
    .bind(email, iso, iso)
    .run();
  const row = await db
    .prepare("SELECT id, email, display_name FROM core_users WHERE email = ?")
    .bind(email)
    .first<{ id: number; email: string; display_name: string | null }>();
  if (!row) throw new Error("ユーザーを登録できませんでした");

  const user: User = { id: row.id, email: row.email, displayName: row.display_name };
  userCache.set(email, { user, lastSeenWrittenAt: now.getTime() });
  return user;
}
