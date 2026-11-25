/**
 * 機能の一覧。src/features/<フォルダ>/feature.ts を自動で集める。
 * 新しい機能は、フォルダを足して feature.ts(宣言)を置くだけで、ホームに並ぶ。
 */
import { validateFeatures, type FeatureMeta } from "../core/shared/feature";

const modules = import.meta.glob<{ default: FeatureMeta | FeatureMeta[] }>("./*/feature.ts", { eager: true });

export interface RegisteredFeature {
  meta: FeatureMeta;
  /** 機能のフォルダ名(D1 のテーブル名の接頭辞にも使う) */
  folder: string;
}

export const registeredFeatures: RegisteredFeature[] = Object.entries(modules)
  .flatMap(([path, mod]) => {
    const folder = path.split("/")[1] ?? "";
    const defs = Array.isArray(mod.default) ? mod.default : [mod.default];
    return defs.map((meta) => ({ meta, folder }));
  })
  .sort((a, b) => a.meta.order - b.meta.order || a.meta.id.localeCompare(b.meta.id));

export const features: FeatureMeta[] = registeredFeatures.map((r) => r.meta);

const errors = validateFeatures(features);
if (errors.length > 0) {
  throw new Error(`機能の宣言に誤りがあります:\n${errors.join("\n")}`);
}
