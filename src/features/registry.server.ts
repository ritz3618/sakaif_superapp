/** 機能のサーバー側(src/features/<フォルダ>/server.ts)を自動で集める。server.ts が無い機能もある。 */
import type { RegisteredFeatureServer } from "../core/server/app";
import type { FeatureServer } from "../core/server/feature-api";
import { registeredFeatures } from "./registry";

const modules = import.meta.glob<{ default: FeatureServer }>("./*/server.ts", { eager: true });

export const featureServers: RegisteredFeatureServer[] = registeredFeatures.flatMap(({ meta, folder }) => {
  const mod = modules[`./${folder}/server.ts`];
  return mod ? [{ meta, server: mod.default }] : [];
});
