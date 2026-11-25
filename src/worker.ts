/**
 * Worker の入口。共通部分(core)と機能の一覧(features)を組み合わせるだけで、処理は持たない。
 */
import { createApp } from "./core/server/app";
import { coreMigrations } from "./core/server/db/core-migrations";
import { ensureMigrated } from "./core/server/db/migrate";
import type { Env } from "./core/server/env";
import { runScheduled } from "./core/server/scheduler";
import { features } from "./features/registry";
import { featureMigrations } from "./features/registry.migrations";
import { featureServers } from "./features/registry.server";

const migrations = [...coreMigrations, ...featureMigrations];
const app = createApp({ features, servers: featureServers, migrations });

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await ensureMigrated(env.DB, migrations);
    await runScheduled(env, controller.scheduledTime, featureServers);
  },
} satisfies ExportedHandler<Env>;
