/**
 * 共通部分(サーバー側)の組み立て。worker.ts から、機能の一覧を渡して呼ぶ。
 */
import { createApp, type RegisteredFeatureServer } from "./app";
import { coreMigrations } from "./db/core-migrations";
import { ensureMigrated, type Migration } from "./db/migrate";
import type { Env } from "./env";
import type { FeatureMeta } from "../shared/feature";
import { runScheduled } from "./scheduler";
import { buildSettingsRegistry } from "./settings";

export interface CoreInput {
  features: readonly FeatureMeta[];
  servers: readonly RegisteredFeatureServer[];
  featureMigrations: readonly Migration[];
}

export function createCore(input: CoreInput): ExportedHandler<Env> {
  const migrations = [...coreMigrations, ...input.featureMigrations];
  const registry = buildSettingsRegistry(input.features);
  const app = createApp({ features: input.features, servers: input.servers, migrations, registry });
  return {
    fetch: app.fetch,
    async scheduled(controller, env) {
      await ensureMigrated(env.DB, migrations);
      await runScheduled(env, controller.scheduledTime, input.servers, registry);
    },
  };
}
