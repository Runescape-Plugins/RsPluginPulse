import { getLatestSnapshotTime, getPlugin, getPluginRanks, getPluginTrend, getPluginTrendRecent } from "@rspluginpulse/db";
import { CACHE_CEILING, remember, rememberBriefly } from "@/lib/cache";
import { jsonWithCors, OPTIONS as corsOptions } from "@/lib/cors";
import { parseGame } from "@/lib/game";
import { resolvePlugin } from "@/lib/resolveEntity";

export const OPTIONS = corsOptions;

// "today"/"24h" zoom wants the raw ingest-cadence points, not
// getPluginTrend's one-point-per-day forward-fill -- see
// getPluginTrendRecent. Anything else (including no param) keeps the
// existing daily series untouched.
const RECENT_WINDOW_HOURS: Record<string, number> = { "24h": 24 };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const game = parseGame(searchParams.get("game"));
  const window = searchParams.get("window");

  const freshness = (await rememberBriefly("freshness:global", () => getLatestSnapshotTime())) ?? "none";
  const result = await resolvePlugin(id, game, (pluginId) =>
    remember(`plugin-trend:${pluginId}:${window ?? "daily"}`, CACHE_CEILING.ENTITY, freshness, async () => {
      const plugin = await getPlugin(pluginId);
      if (!plugin) return null;
      const trend =
        window === "today"
          ? await getPluginTrendRecent(pluginId, new Date().toISOString().slice(0, 10) + "T00:00:00.000Z")
          : window && RECENT_WINDOW_HOURS[window]
            ? await getPluginTrendRecent(pluginId, new Date(Date.now() - RECENT_WINDOW_HOURS[window] * 60 * 60_000).toISOString())
            : await getPluginTrend(pluginId);
      // A targeted RANK() lookup (same one the leaderboards use), not the
      // page fetching the whole alltime leaderboard just to find its own
      // position in it.
      const allTimeRank = (await getPluginRanks([pluginId], "alltime", plugin.game)).get(pluginId) ?? null;
      return { pluginId, plugin, trend, allTimeRank };
    }),
  );
  if (!result) {
    return jsonWithCors({ error: "plugin not found" }, { status: 404 });
  }

  return jsonWithCors(result, { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } });
}
