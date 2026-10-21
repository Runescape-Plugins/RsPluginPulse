import { getAllAuthorRanks, getAuthorProfile, getLatestSnapshotTime, getTopPlugins } from "@rspluginpulse/db";
import { CACHE_CEILING, remember, rememberBriefly } from "@/lib/cache";
import { jsonWithCors, OPTIONS as corsOptions } from "@/lib/cors";
import { parseGame } from "@/lib/game";
import { resolveAuthor } from "@/lib/resolveEntity";

export const OPTIONS = corsOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const game = parseGame(searchParams.get("game"));

  const freshness = (await rememberBriefly("freshness:global", () => getLatestSnapshotTime())) ?? "none";
  const author = await resolveAuthor(id, game, (authorId) =>
    remember(`author:${authorId}`, CACHE_CEILING.ENTITY, freshness, async () => {
      // These scan every plugin/author in the game, not just this one, so
      // they're cached per-game rather than per-author -- otherwise the
      // first author profile view after each hourly ingest, for every
      // distinct author someone looks at, re-ran all four full-catalog
      // queries from scratch (very noticeable on runelite's large catalog).
      // Keyed per-game, they're computed once per freshness epoch and
      // reused by every author viewed in that game afterwards.
      const [hotPlugins, allTimeRanks, hotRanks, weeklyRanks] = await Promise.all([
        remember(`authorProfile:hotPlugins:${game}`, CACHE_CEILING.LEADERBOARD, freshness, () => getTopPlugins("hot", 10, game)),
        remember(`authorProfile:ranks:alltime:${game}`, CACHE_CEILING.LEADERBOARD, freshness, () => getAllAuthorRanks("alltime", game)),
        remember(`authorProfile:ranks:hot:${game}`, CACHE_CEILING.LEADERBOARD, freshness, () => getAllAuthorRanks("hot", game)),
        remember(`authorProfile:ranks:weekly:${game}`, CACHE_CEILING.LEADERBOARD, freshness, () => getAllAuthorRanks("weekly", game)),
      ]);
      return getAuthorProfile(authorId, { hotPlugins, allTimeRanks, hotRanks, weeklyRanks });
    }),
  );
  if (!author) {
    return jsonWithCors({ error: "author not found" }, { status: 404 });
  }

  return jsonWithCors(author, { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } });
}
