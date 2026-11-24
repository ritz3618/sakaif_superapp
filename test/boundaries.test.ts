/**
 * 「共通部分」と「機能」の境界を、機械的に確認する。
 * - core は、個別の機能(src/features)を読み込まない。
 * - 機能は、ほかの機能を読み込まない。core からは、決められた入口(feature-api と shared)だけを使う。
 * - 機能の D1 テーブル名は「フォルダ名_」で始める。共通部分のテーブル名は「core_」で始める。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function listFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/g)) found.push(m[1]!);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]!);
  for (const m of text.matchAll(/import\.meta\.glob[^(]*\(\s*["']([^"']+)["']/g)) found.push(m[1]!);
  return found;
}

function resolveRelative(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return relative(SRC, join(file, "..", spec)).split(sep).join("/");
}

const codeFiles = listFiles(SRC, /\.(ts|tsx)$/);

describe("境界のルール", () => {
  it("core は src/features を読み込まない", () => {
    const violations = codeFiles
      .filter((f) => relative(SRC, f).startsWith(`core${sep}`))
      .flatMap((f) =>
        importsOf(f)
          .map((spec) => resolveRelative(f, spec))
          .filter((target): target is string => target !== null && target.startsWith("features"))
          .map((target) => `${relative(SRC, f)} → ${target}`),
      );
    expect(violations).toEqual([]);
  });

  it("機能は、ほかの機能を読み込まず、core は決められた入口だけを使う", () => {
    const allowedCore = [/^core\/shared\//, /^core\/server\/feature-api$/, /^core\/web\/feature-api$/];
    const violations: string[] = [];
    for (const f of codeFiles) {
      const rel = relative(SRC, f).split(sep);
      if (rel[0] !== "features" || rel.length < 3) continue; // registry*.ts は組み立て役なので対象外
      const folder = rel[1]!;
      for (const spec of importsOf(f)) {
        const target = resolveRelative(f, spec);
        if (target === null) continue; // npm パッケージ
        if (target.startsWith(`features/${folder}/`)) continue;
        if (allowedCore.some((re) => re.test(target))) continue;
        violations.push(`${rel.join("/")} → ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("D1 のテーブル名と索引名は、所有者の接頭辞で始まる", () => {
    const sqlFiles = listFiles(SRC, /\.sql$/);
    const violations: string[] = [];
    for (const f of sqlFiles) {
      const rel = relative(SRC, f).split(sep);
      const prefix = rel[0] === "core" ? "core_" : `${rel[1]}_`;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)) {
        if (!m[1]!.startsWith(prefix)) violations.push(`${rel.join("/")}: ${m[1]}`);
      }
    }
    expect(sqlFiles.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
