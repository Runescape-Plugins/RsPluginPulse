import { randomBytes } from "crypto";
import { getPool } from "./client";
import { normalizeSlug, slugify } from "./slug";
import type {
  AnnotationGameKey,
  AnnouncementCandidate,
  AuthorLeaderboardRow,
  AuthorProfile,
  CategoryStat,
  CategoryStatsPage,
  CoAuthor,
  CompareItem,
  CompareMetric,
  CompareRange,
  CompareResult,
  CompareType,
  DiscordAnnouncementKind,
  DiscordAnnouncementWatch,
  DiscordAnnouncementWatchInput,
  DiscordChannelTopic,
  DiscordChannelTopicInput,
  DiscordEntityAnnouncement,
  DiscordEntityAnnouncementInput,
  DiscordEntityAnnouncementKind,
  DiscordEntityKind,
  DiscordGuildAdmin,
  DiscordGuildAnnouncementEmbed,
  DiscordGuildSubscription,
  DiscordSession,
  EmbedCardConfig,
  EmbedCardOptions,
  EmbedCardType,
  FastestGrowingPlugin,
  GameUpdate,
  GameUpdateInput,
  GrowthSparkRow,
  IngestedMod,
  NewestPluginRow,
  NewReleaseRow,
  Period,
  PluginLeaderboardRow,
  PluginRelease,
  PluginReleaseInput,
  PluginTrendPoint,
  SearchResult,
  SiteAdmin,
  SiteStats,
  SpecialEvent,
  SpecialEventInput,
  StatsOverview,
} from "./types";

// Mints (once) and reuses a stable surrogate integer id for an entity that
// has no native numeric id upstream -- e.g. a RuneLite plugin keyed by its
// internalName, or an author keyed by GitHub login. The sequence starts
// at 900,000,000, well clear of mod.io's own 6-8 digit ids, so the two
// namespaces never collide and every existing `Number(id)` code path
// keeps working regardless of which game a plugin belongs to.
export async function getOrCreateExternalId(game: string, kind: "plugin" | "author", externalKey: string): Promise<number> {
  const pool = getPool();
  const existing = await pool.query(`SELECT id FROM external_id_map WHERE game = $1 AND kind = $2 AND external_key = $3`, [
    game,
    kind,
    externalKey,
  ]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const { rows } = await pool.query(
    `INSERT INTO external_id_map (game, kind, external_key, id)
     VALUES ($1, $2, $3, nextval('external_id_seq'))
     ON CONFLICT (game, kind, external_key) DO UPDATE SET id = external_id_map.id
     RETURNING id`,
    [game, kind, externalKey],
  );
  return rows[0].id;
}

// So an ingest script can skip re-resolving expensive per-entity metadata
// (e.g. RuneLite's GitHub repo lookup) for plugins it has already seen.
export async function getExistingNameIds(game: string): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT name_id FROM plugins WHERE game = $1`, [game]);
  return new Set(rows.map((r) => r.name_id));
}

export async function getLatestSnapshotTime(game?: string): Promise<string | null> {
  const pool = getPool();
  // game is denormalized onto plugin_snapshots itself (see schema.sql)
  // specifically so this hits plugin_snapshots_game_captured_idx directly
  // -- filtering via a join to plugins instead turns into a seq scan once
  // this table passes a few hundred thousand rows.
  const { rows } = game
    ? await pool.query(`SELECT max(captured_at) AS latest FROM plugin_snapshots WHERE game = $1`, [game])
    : await pool.query(`SELECT max(captured_at) AS latest FROM plugin_snapshots`);
  return rows[0]?.latest ? rows[0].latest.toISOString() : null;
}

function generateShortId(): string {
  return randomBytes(6).toString("base64url");
}

// Reuses an existing short id for the same (type, entity, options) combo
// instead of minting a new one every time the embed builder re-sends the
// same settings.
export async function createOrGetEmbedCard(type: EmbedCardType, entityId: number, options: EmbedCardOptions): Promise<string> {
  const pool = getPool();
  const params = [
    type,
    entityId,
    options.theme,
    options.spark,
    options.sparkDays,
    options.showSubtitle,
    options.showHot,
    options.showStatDownloads,
    options.showStatWeek,
    options.showStatThird,
    options.showFooter,
    options.showImage,
    options.accentColor,
    options.bgColor,
    options.textColor,
  ];
  const existing = await pool.query(
    `SELECT id FROM embed_cards
     WHERE type = $1 AND entity_id = $2 AND theme = $3 AND spark = $4 AND spark_days = $5
       AND show_subtitle = $6 AND show_hot = $7
       AND show_stat_downloads = $8 AND show_stat_week = $9 AND show_stat_third = $10
       AND show_footer = $11 AND show_image = $12
       AND accent_color = $13 AND bg_color = $14 AND text_color = $15`,
    params,
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateShortId();
    try {
      await pool.query(
        `INSERT INTO embed_cards (
           id, type, entity_id, theme, spark, spark_days, show_subtitle, show_hot,
           show_stat_downloads, show_stat_week, show_stat_third, show_footer, show_image,
           accent_color, bg_color, text_color
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [id, ...params],
      );
      return id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") continue;
      throw err;
    }
  }
  throw new Error("failed to generate a unique embed card id");
}

export async function getEmbedCard(id: string): Promise<EmbedCardConfig | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, type, entity_id, theme, spark, spark_days, show_subtitle, show_hot,
            show_stat_downloads, show_stat_week, show_stat_third, show_footer, show_image,
            accent_color, bg_color, text_color
     FROM embed_cards WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    type: row.type,
    entityId: row.entity_id,
    theme: row.theme,
    spark: row.spark,
    sparkDays: row.spark_days,
    showSubtitle: row.show_subtitle,
    showHot: row.show_hot,
    showStatDownloads: row.show_stat_downloads,
    showStatWeek: row.show_stat_week,
    showStatThird: row.show_stat_third,
    showFooter: row.show_footer,
    showImage: row.show_image,
    accentColor: row.accent_color,
    bgColor: row.bg_color,
    textColor: row.text_color,
  };
}

export async function getRandomPluginId(game = "runescape"): Promise<{ id: number; nameId: string } | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name_id FROM plugins WHERE game = $1 ORDER BY random() LIMIT 1`, [game]);
  if (rows.length === 0) return null;
  return { id: rows[0].id, nameId: rows[0].name_id };
}

// Authors have no slug of their own upstream (see schema.sql), so every
// nameId handed out here is derived from author_name via slugify(). Two
// authors can collide on that derived slug -- most commonly non-Latin
// names, which slugify() strips down to "" since it only keeps [a-z0-9] --
// so collisions are resolved by suffixing -2, -3... onto every name after
// the first, in author_id order (lowest id keeps the bare slug). Ordering
// by author_id rather than query order keeps the assignment stable across
// calls instead of depending on incidental row order.
// getAuthorSlugMap is called from roughly a dozen places below (every
// leaderboard row, plugin/author detail page, newest-plugins list,
// compare, and slug resolution itself all need it to decorate a row with
// its author's nameId, or to resolve one) -- without caching, every one
// of those re-ran this full plugin_authors x plugins join plus an
// in-Node slugify/collision pass over *every* author in the game, often
// more than once per page load. A short TTL (not invalidate-on-write)
// because packages/ingest -- the only thing that actually changes this
// data -- runs as a separate process with no way to reach into this
// one's memory; ingest only runs hourly anyway, so a few minutes of
// staleness here is unnoticeable in practice.
const AUTHOR_SLUG_MAP_CACHE_MS = 5 * 60 * 1000;
const authorSlugMapCache = new Map<string, { value: Map<number, string>; expiresAt: number }>();
const authorSlugMapInFlight = new Map<string, Promise<Map<number, string>>>();

async function getAuthorSlugMap(game: string): Promise<Map<number, string>> {
  const cached = authorSlugMapCache.get(game);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const inFlight = authorSlugMapInFlight.get(game);
  if (inFlight) return inFlight;

  const loading = (async () => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT DISTINCT pa.author_id, pa.author_name
         FROM plugin_authors pa
         JOIN plugins p ON p.id = pa.plugin_id
         WHERE p.game = $1
         ORDER BY pa.author_id ASC`,
        [game],
      );
      const seen = new Map<string, number>();
      const map = new Map<number, string>();
      for (const row of rows) {
        const base = slugify(row.author_name) || "author";
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        map.set(row.author_id, count === 1 ? base : `${base}-${count}`);
      }
      authorSlugMapCache.set(game, { value: map, expiresAt: Date.now() + AUTHOR_SLUG_MAP_CACHE_MS });
      return map;
    } finally {
      authorSlugMapInFlight.delete(game);
    }
  })();
  authorSlugMapInFlight.set(game, loading);
  return loading;
}

// Newest plugins first -- unlike the leaderboards, this intentionally
// includes everything (no library-tag exclusion) since it's about
// discoverability, not ranking fairness.
export async function getNewestPlugins(limit = 50, game = "runescape"): Promise<NewestPluginRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.profile_url, p.tags, p.logo_url, p.date_added, l.downloads_total, ${CO_AUTHOR_NAMES_SELECT}
     FROM plugins p
     JOIN LATERAL (
       SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     ${CO_AUTHOR_NAMES_JOIN}
     WHERE p.game = $2
     ORDER BY p.date_added DESC
     LIMIT $1`,
    [limit, game],
  );
  const authorSlugs = await getAuthorSlugMap(game);
  return rows.map((row) => ({
    id: row.id,
    nameId: row.name_id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    authorNameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    profileUrl: row.profile_url,
    tags: row.tags ?? [],
    logoUrl: row.logo_url,
    dateAdded: row.date_added.toISOString(),
    downloadsTotal: Number(row.downloads_total),
    coAuthorNames: row.co_author_names ?? [],
  }));
}

// Plugin count per game -- just the one number per game key actually
// stored (currently "runescape" and "runelite"; see schema.sql's `plugins`
// table), used for the Discord bot's own global presence text rather than
// anything web-facing (getSiteStats above is the per-game equivalent for
// the site itself).
export async function getPluginCountsByGame(): Promise<Record<string, number>> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT game, count(*)::int AS n FROM plugins GROUP BY game`);
  return Object.fromEntries(rows.map((r) => [r.game as string, r.n as number]));
}

export async function getSiteStats(game = "runescape"): Promise<SiteStats> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM plugins WHERE game = $1) AS plugin_count,
       (SELECT count(DISTINCT author_id)::int FROM plugins WHERE game = $1) AS author_count,
       (SELECT COALESCE(SUM(l.downloads_total), 0)::bigint
          FROM plugins p
          JOIN LATERAL (SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
          WHERE p.game = $1
       ) AS downloads_total,
       (SELECT COALESCE(SUM(l.subscribers_total), 0)::bigint
          FROM plugins p
          JOIN LATERAL (SELECT subscribers_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
          WHERE p.game = $1
       ) AS subscribers_total,
       (SELECT max(s.captured_at) FROM plugin_snapshots s WHERE s.game = $1) AS updated_at`,
    [game],
  );
  const row = rows[0];
  return {
    pluginCount: row.plugin_count,
    authorCount: row.author_count,
    downloadsTotal: Number(row.downloads_total),
    subscribersTotal: Number(row.subscribers_total),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

// Bulk-upserts the whole batch in 3 statements instead of ~4 round trips
// per plugin (one INSERT ON CONFLICT each for plugins/plugin_snapshots,
// plus a DELETE+INSERT per co-author for plugin_authors) -- that loop
// measured ~3.3s for a real 2621-plugin RuneLite run even against a local
// database; every extra millisecond of network latency to a real hosted
// Postgres multiplies across ~11,000 sequential round trips.
//
// `plugins.tags` is itself an array column, which is exactly the case
// unnest() can't express row-aligned with the other columns (it flattens
// nested arrays instead of keeping one array per row) -- json_to_recordset
// sidesteps that entirely since each JSON object's own "tags" field is
// just a plain JSON array, mapped straight to a Postgres text[]. The
// plugin_snapshots insert has no array columns, so a plain unnest() over
// parallel arrays works fine there.
export async function upsertPluginsAndSnapshot(mods: IngestedMod[], capturedAt: Date): Promise<void> {
  if (mods.length === 0) return;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Deduped by id (last occurrence wins, same convention as the
    // plugin_authors dedup below) -- a single INSERT...ON CONFLICT DO
    // UPDATE can't affect the same row twice within one statement, unlike
    // the old per-row loop this replaced, which just silently re-upserted
    // a duplicate as two independent statements. Guards against a rare
    // upstream data hiccup (pagination overlap, a retried page) throwing
    // out the whole batch instead of just double-counting one row the
    // way it always harmlessly did before.
    const dedupedMods = [...new Map(mods.map((m) => [m.id, m])).values()];

    const pluginsJson = JSON.stringify(
      dedupedMods.map((m) => ({
        id: m.id,
        game: m.game,
        name_id: m.nameId,
        name: m.name,
        author_id: m.authorId,
        author_name: m.authorName,
        author_profile_url: m.authorProfileUrl,
        author_avatar_url: m.authorAvatarUrl,
        profile_url: m.profileUrl,
        tags: m.tags,
        logo_url: m.logoUrl,
        summary: m.summary,
        ratings_total: m.ratingsTotal,
        ratings_positive: m.ratingsPositive,
        ratings_negative: m.ratingsNegative,
        ratings_percentage_positive: m.ratingsPercentagePositive,
        ratings_display_text: m.ratingsDisplayText,
        date_added: m.dateAdded,
        date_updated: m.dateUpdated,
      })),
    );
    await client.query(
      `INSERT INTO plugins (id, game, name_id, name, author_id, author_name, author_profile_url, author_avatar_url, profile_url, tags, logo_url, summary, ratings_total, ratings_positive, ratings_negative, ratings_percentage_positive, ratings_display_text, date_added, date_updated)
       SELECT id, game, name_id, name, author_id, author_name, author_profile_url, author_avatar_url, profile_url, tags, logo_url, summary, ratings_total, ratings_positive, ratings_negative, ratings_percentage_positive, ratings_display_text, to_timestamp(date_added), to_timestamp(date_updated)
       FROM json_to_recordset($1::json) AS x(
         id int, game text, name_id text, name text, author_id int, author_name text, author_profile_url text, author_avatar_url text,
         profile_url text, tags text[], logo_url text, summary text, ratings_total int, ratings_positive int, ratings_negative int,
         ratings_percentage_positive int, ratings_display_text text, date_added double precision, date_updated double precision
       )
       ON CONFLICT (id) DO UPDATE SET
         name_id = EXCLUDED.name_id,
         name = EXCLUDED.name,
         author_id = EXCLUDED.author_id,
         author_name = EXCLUDED.author_name,
         author_profile_url = EXCLUDED.author_profile_url,
         author_avatar_url = EXCLUDED.author_avatar_url,
         profile_url = EXCLUDED.profile_url,
         tags = EXCLUDED.tags,
         logo_url = EXCLUDED.logo_url,
         summary = EXCLUDED.summary,
         ratings_total = EXCLUDED.ratings_total,
         ratings_positive = EXCLUDED.ratings_positive,
         ratings_negative = EXCLUDED.ratings_negative,
         ratings_percentage_positive = EXCLUDED.ratings_percentage_positive,
         ratings_display_text = EXCLUDED.ratings_display_text,
         date_updated = EXCLUDED.date_updated`,
      [pluginsJson],
    );

    await client.query(
      `INSERT INTO plugin_snapshots (plugin_id, captured_at, downloads_total, downloads_today, subscribers_total, popularity_rank_position, game, date_updated)
       SELECT plugin_id, captured_at, downloads_total, downloads_today, subscribers_total, popularity_rank_position, game, to_timestamp(date_updated)
       FROM unnest($1::int[], $2::timestamptz[], $3::int[], $4::int[], $5::int[], $6::int[], $7::text[], $8::double precision[])
         AS t(plugin_id, captured_at, downloads_total, downloads_today, subscribers_total, popularity_rank_position, game, date_updated)
       ON CONFLICT (plugin_id, captured_at) DO NOTHING`,
      [
        dedupedMods.map((m) => m.id),
        dedupedMods.map(() => capturedAt),
        dedupedMods.map((m) => m.downloadsTotal),
        dedupedMods.map((m) => m.downloadsToday),
        dedupedMods.map((m) => m.subscribersTotal),
        dedupedMods.map((m) => m.popularityRankPosition),
        dedupedMods.map((m) => m.game),
        dedupedMods.map((m) => m.dateUpdated),
      ],
    );

    // Replace the roster wholesale each run -- cheap at this scale and
    // avoids tracking additions/removals/reordering between ingests. One
    // bulk DELETE for every plugin in this batch, then one bulk INSERT for
    // every (plugin, co-author) row -- deduped by (plugin_id, author_id)
    // first (keeping the *last* occurrence per pair, same as the old
    // per-row loop's ON CONFLICT DO UPDATE would've ended up with) since a
    // single INSERT ON CONFLICT DO UPDATE can't affect the same row twice
    // in one statement, unlike separate per-row statements.
    const pluginIds = dedupedMods.map((m) => m.id);
    await client.query(`DELETE FROM plugin_authors WHERE plugin_id = ANY($1::int[])`, [pluginIds]);

    const authorRowsByKey = new Map<string, { plugin_id: number; author_id: number; author_name: string; author_avatar_url: string | null; author_profile_url: string | null; position: number }>();
    for (const mod of dedupedMods) {
      mod.coAuthors.forEach((co, i) => {
        authorRowsByKey.set(`${mod.id}:${co.authorId}`, {
          plugin_id: mod.id,
          author_id: co.authorId,
          author_name: co.name,
          author_avatar_url: co.avatarUrl,
          author_profile_url: co.profileUrl,
          position: i,
        });
      });
    }
    const authorRows = [...authorRowsByKey.values()];
    if (authorRows.length > 0) {
      await client.query(
        `INSERT INTO plugin_authors (plugin_id, author_id, author_name, author_avatar_url, author_profile_url, position)
         SELECT plugin_id, author_id, author_name, author_avatar_url, author_profile_url, position
         FROM json_to_recordset($1::json) AS x(plugin_id int, author_id int, author_name text, author_avatar_url text, author_profile_url text, position int)
         ON CONFLICT (plugin_id, author_id) DO UPDATE SET
           author_name = EXCLUDED.author_name,
           author_avatar_url = EXCLUDED.author_avatar_url,
           author_profile_url = EXCLUDED.author_profile_url,
           position = EXCLUDED.position`,
        [JSON.stringify(authorRows)],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// RuneLite's downloads_total is a live "currently reporting installs" gauge,
// not a cumulative counter (see ingest/runelite.ts), so it naturally drifts
// up and down hour to hour. Diffing two single snapshots picks up that
// hour-of-day/day-of-week noise as if it were real growth or decline --
// for small plugins (most of the catalog) that noise dwarfs the signal, so
// roughly half of them show a meaningless +/-1 "gain". Averaging a window
// of snapshots around each comparison endpoint cancels most of that out.
// Harmless for mod.io's monotonic cumulative downloads too, where it just
// nudges both endpoints down slightly without changing the sign of the gain.
// Window scales with the cutoff -- a 1-day "hot" diff can't average over
// multiple days, while a 30-day diff can afford a few -- capped so it never
// eats into the period being measured.
function gainWindowDays(cutoffDays: number): number {
  return Math.min(cutoffDays / 4, 3);
}

// Co-authors beyond the primary (plugin_authors position 0), for the
// leaderboard's "+N" badge. Aggregated here so every leaderboard query
// stays a single round trip regardless of catalog size, rather than a
// per-plugin fetch -- most plugins have no rows past position 0 anyway.
const CO_AUTHOR_NAMES_JOIN = `
     LEFT JOIN LATERAL (
       SELECT array_agg(author_name ORDER BY position) AS names
       FROM plugin_authors pa WHERE pa.plugin_id = p.id AND pa.position >= 1
     ) co ON true`;
const CO_AUTHOR_NAMES_SELECT = "COALESCE(co.names, ARRAY[]::text[]) AS co_author_names";

// Latest snapshot per plugin, ordered by the requested metric.
async function topPluginsByLatestMetric(metric: "downloads_total" | "downloads_today", game: string, limit: number): Promise<PluginLeaderboardRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.author_avatar_url, p.profile_url, p.tags, l.${metric} AS value, ${CO_AUTHOR_NAMES_SELECT}
     FROM plugins p
     JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     ${CO_AUTHOR_NAMES_JOIN}
     WHERE p.game = $2
     ORDER BY value DESC
     LIMIT $1`,
    [limit, game],
  );
  const authorSlugs = await getAuthorSlugMap(game);
  return rows.map((row) => toPluginRow(row, authorSlugs));
}

// Downloads gained between the latest snapshot and the nearest snapshot at
// or before the cutoff, falling back to the earliest snapshot when less
// than `cutoffDays` of history exists yet.
async function topPluginsByGain(cutoffDays: number, game: string, limit: number): Promise<PluginLeaderboardRow[]> {
  const pool = getPool();
  const windowDays = gainWindowDays(cutoffDays);
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.author_avatar_url, p.profile_url, p.tags,
            ROUND(COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total)) AS value,
            ${CO_AUTHOR_NAMES_SELECT}
     FROM plugins p
     JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT avg(downloads_total) AS downloads_total
       FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at >= now() - ($4 * interval '1 day')
     ) nowavg ON true
     LEFT JOIN LATERAL (
       SELECT avg(downloads_total) AS downloads_total
       FROM plugin_snapshots s WHERE s.plugin_id = p.id
         AND s.captured_at BETWEEN now() - (($2 + $4) * interval '1 day') AND now() - (($2 - $4) * interval '1 day')
     ) b1 ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
     ) b2 ON true
     ${CO_AUTHOR_NAMES_JOIN}
     WHERE p.game = $3
     ORDER BY value DESC
     LIMIT $1`,
    [limit, cutoffDays, game, windowDays],
  );
  const authorSlugs = await getAuthorSlugMap(game);
  return rows.map((row) => toPluginRow(row, authorSlugs));
}

// Rank of specific plugins within the alltime/hot leaderboard, without
// fetching the whole catalog to find them by linear search -- same
// per-plugin value and excluded tag as getTopPlugins, just counted in SQL
// and filtered down to the requested ids before anything crosses the wire.
export async function getPluginRanks(pluginIds: number[], metric: "alltime" | "hot", game = "runescape"): Promise<Map<number, number>> {
  if (pluginIds.length === 0) return new Map();
  const pool = getPool();
  // RuneLite's plugin-hub exposes only a live install gauge, not a true daily
  // download counter (downloadsToday is hardcoded to 0 in ingest/runelite.ts),
  // so every RuneLite plugin ties at 0 and RANK() hands out rank 1 to all of
  // them. Approximate "hot" the same way weekly/monthly already do: diff the
  // gauge against ~1 day ago.
  const isHotGain = metric === "hot" && game === "runelite";
  const windowDays = gainWindowDays(1);
  const valueSql =
    metric === "alltime"
      ? "l.downloads_total"
      : isHotGain
        ? "COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total)"
        : "l.downloads_today";
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT p.id, RANK() OVER (ORDER BY ${valueSql} DESC) AS rank
       FROM plugins p
       JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) l ON true
       ${
         isHotGain
           ? `LEFT JOIN LATERAL (
                SELECT avg(downloads_total) AS downloads_total
                FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at >= now() - ($3 * interval '1 day')
              ) nowavg ON true
              LEFT JOIN LATERAL (
                SELECT avg(downloads_total) AS downloads_total
                FROM plugin_snapshots s WHERE s.plugin_id = p.id
                  AND s.captured_at BETWEEN now() - ((1 + $3) * interval '1 day') AND now() - ((1 - $3) * interval '1 day')
              ) b1 ON true
              LEFT JOIN LATERAL (
                SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
              ) b2 ON true`
           : ""
       }
       WHERE p.game = $2
     )
     SELECT id, rank FROM ranked WHERE id = ANY($1::int[])`,
    isHotGain ? [pluginIds, game, windowDays] : [pluginIds, game],
  );
  return new Map(rows.map((row) => [row.id, Number(row.rank)]));
}

// Ranks by growth *rate* rather than raw gain, so a small plugin that
// doubled its downloads ranks above a huge plugin that gained more in
// absolute terms. Denominators are clamped to a floor so brand-new
// plugins with a near-zero baseline don't produce absurd percentages.
export async function getFastestGrowingPlugins(limit = 5, cutoffDays = 7, game = "runescape"): Promise<FastestGrowingPlugin[]> {
  const pool = getPool();
  const windowDays = gainWindowDays(cutoffDays);
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.profile_url,
            l.downloads_total AS downloads_total,
            l.subscribers_total AS subscribers_total,
            ROUND(COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total)) AS downloads_gain,
            ROUND(COALESCE(nowavg.subscribers_total, l.subscribers_total) - COALESCE(b1.subscribers_total, b2.subscribers_total, l.subscribers_total)) AS subscribers_gain,
            (COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total))::float
              / GREATEST(COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total), 1) * 100 AS downloads_growth_pct,
            (
              (COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total))::float
                / GREATEST(COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total), 20)
              +
              (COALESCE(nowavg.subscribers_total, l.subscribers_total) - COALESCE(b1.subscribers_total, b2.subscribers_total, l.subscribers_total))::float
                / GREATEST(COALESCE(b1.subscribers_total, b2.subscribers_total, l.subscribers_total), 10)
            ) AS growth_score,
            ${CO_AUTHOR_NAMES_SELECT}
     FROM plugins p
     JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT avg(downloads_total) AS downloads_total, avg(subscribers_total) AS subscribers_total
       FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at >= now() - ($4 * interval '1 day')
     ) nowavg ON true
     LEFT JOIN LATERAL (
       SELECT avg(downloads_total) AS downloads_total, avg(subscribers_total) AS subscribers_total
       FROM plugin_snapshots s WHERE s.plugin_id = p.id
         AND s.captured_at BETWEEN now() - (($2 + $4) * interval '1 day') AND now() - (($2 - $4) * interval '1 day')
     ) b1 ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
     ) b2 ON true
     ${CO_AUTHOR_NAMES_JOIN}
     WHERE p.game = $3
     ORDER BY growth_score DESC
     LIMIT $1`,
    [limit, cutoffDays, game, windowDays],
  );
  const authorSlugs = await getAuthorSlugMap(game);
  return rows
    .map((row) => ({
      id: row.id,
      nameId: row.name_id,
      name: row.name,
      authorId: row.author_id,
      authorName: row.author_name,
      authorNameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
      profileUrl: row.profile_url,
      downloadsTotal: Number(row.downloads_total),
      subscribersTotal: Number(row.subscribers_total),
      coAuthorNames: row.co_author_names ?? [],
      downloadsGain: Number(row.downloads_gain),
      subscribersGain: Number(row.subscribers_gain),
      downloadsGrowthPct: Number(row.downloads_growth_pct),
      growthScore: Number(row.growth_score),
    }))
    .filter((p) => p.growthScore > 0);
}

export async function getTopPlugins(period: Period, limit = 50, game = "runescape"): Promise<PluginLeaderboardRow[]> {
  if (period === "alltime") return topPluginsByLatestMetric("downloads_total", game, limit);
  if (period === "hot") {
    // RuneLite has no real daily download counter (see getPluginRanks), so
    // approximate "today" as a 1-day gain on the live install gauge instead
    // of the always-zero downloads_today column.
    if (game === "runelite") return topPluginsByGain(1, game, limit);
    return topPluginsByLatestMetric("downloads_today", game, limit);
  }
  if (period === "weekly") return topPluginsByGain(7, game, limit);
  return topPluginsByGain(30, game, limit);
}

// Aggregates per author directly in SQL (same per-author pattern as
// getAuthorRanks just below) rather than fetching up to 10,000 full plugin
// rows via getTopPlugins and grouping them in JS -- that pulled every
// matching plugin's tags/profile_url/etc across the wire just to keep only
// author_id and value out of each one. ROW_NUMBER picks out each author's
// own highest-value plugin to source their display name/avatar from,
// matching the old JS loop's behavior (it kept the first plugin seen per
// author, and rows arrived sorted by value descending). Ties on value
// (common for "hot", where most authors have 0 downloads today) sort by
// author_id for a deterministic order -- the old JS version's tie order
// depended on incidental row-scan order and was never a guaranteed
// contract either.
export async function getTopAuthors(period: Period, limit = 50, game = "runescape"): Promise<AuthorLeaderboardRow[]> {
  const pool = getPool();

  const valueSql =
    period === "hot"
      ? "l.downloads_today"
      : period === "alltime"
        ? "l.downloads_total"
        : "l.downloads_total - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total)";
  const cutoffDays = period === "monthly" ? 30 : 7;
  const needsGainJoins = period === "weekly" || period === "monthly";

  const { rows } = await pool.query(
    `WITH per_plugin AS (
       SELECT p.author_id, p.author_name, p.author_avatar_url, ${valueSql} AS value
       FROM plugins p
       JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) l ON true
       ${
         needsGainJoins
           ? `LEFT JOIN LATERAL (
                SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - ($3 * interval '1 day')
                ORDER BY s.captured_at DESC LIMIT 1
              ) b1 ON true
              LEFT JOIN LATERAL (
                SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
              ) b2 ON true`
           : ""
       }
       WHERE p.game = $2
     ),
     ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY author_id ORDER BY value DESC) AS rn FROM per_plugin
     )
     SELECT author_id,
            MAX(author_name) FILTER (WHERE rn = 1) AS author_name,
            MAX(author_avatar_url) FILTER (WHERE rn = 1) AS author_avatar_url,
            COUNT(*)::int AS plugin_count,
            SUM(value) AS value
     FROM ranked
     GROUP BY author_id
     ORDER BY value DESC, author_id ASC
     LIMIT $1`,
    needsGainJoins ? [limit, game, cutoffDays] : [limit, game],
  );

  const authorSlugs = await getAuthorSlugMap(game);
  return rows.map((row) => ({
    authorId: row.author_id,
    authorName: row.author_name,
    nameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    avatarUrl: row.author_avatar_url,
    pluginCount: row.plugin_count,
    value: Number(row.value),
  }));
}

// Shared by getAuthorRanks and getAllAuthorRanks -- the per_author/ranked
// CTE below always computes a rank for every author in the game regardless
// of which ids the caller actually wants, so there's no SQL-side cost to
// returning the full map and filtering (if at all) in JS.
async function computeAuthorRanks(period: Period, game: string): Promise<Map<number, number>> {
  const pool = getPool();

  // RuneLite has no real daily download counter (see getPluginRanks), so its
  // "hot" period rides the same gain-diff path as weekly/monthly, just with
  // a 1-day cutoff instead of a flat (always-zero) downloads_today column.
  const isHotGain = period === "hot" && game === "runelite";
  const needsGainJoins = period === "weekly" || period === "monthly" || isHotGain;
  const valueSql =
    period === "alltime"
      ? "l.downloads_total"
      : needsGainJoins
        ? "COALESCE(nowavg.downloads_total, l.downloads_total) - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total)"
        : "l.downloads_today";
  const cutoffDays = period === "monthly" ? 30 : isHotGain ? 1 : 7;
  const windowDays = gainWindowDays(cutoffDays);

  const { rows } = await pool.query(
    `WITH per_author AS (
       SELECT p.author_id, SUM(${valueSql}) AS value
       FROM plugins p
       JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) l ON true
       ${
         needsGainJoins
           ? `LEFT JOIN LATERAL (
                SELECT avg(downloads_total) AS downloads_total
                FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at >= now() - ($3 * interval '1 day')
              ) nowavg ON true
              LEFT JOIN LATERAL (
                SELECT avg(downloads_total) AS downloads_total
                FROM plugin_snapshots s WHERE s.plugin_id = p.id
                  AND s.captured_at BETWEEN now() - (($2 + $3) * interval '1 day') AND now() - (($2 - $3) * interval '1 day')
              ) b1 ON true
              LEFT JOIN LATERAL (
                SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
              ) b2 ON true`
           : ""
       }
       WHERE p.game = $1
       GROUP BY p.author_id
     ),
     ranked AS (
       SELECT author_id, RANK() OVER (ORDER BY value DESC) AS rank FROM per_author
     )
     SELECT author_id, rank FROM ranked`,
    needsGainJoins ? [game, cutoffDays, windowDays] : [game],
  );
  return new Map(rows.map((row) => [row.author_id, Number(row.rank)]));
}

// Rank of specific authors within a period's leaderboard. Authors with no
// ranked plugins at all (e.g. only ever a secondary/co-author) are simply
// absent from the returned map.
export async function getAuthorRanks(authorIds: number[], period: Period, game = "runescape"): Promise<Map<number, number>> {
  if (authorIds.length === 0) return new Map();
  const all = await computeAuthorRanks(period, game);
  const wanted = new Set(authorIds);
  return new Map([...all].filter(([authorId]) => wanted.has(authorId)));
}

// Ranks for every author in the game, for callers (like the author profile
// route) that want to cache the whole-catalog computation once per game and
// look authors up out of it, rather than re-running it per author viewed.
export async function getAllAuthorRanks(period: Period, game = "runescape"): Promise<Map<number, number>> {
  return computeAuthorRanks(period, game);
}

// Trending fallback for an empty query, plus a name/author substring
// match for a real one, always ranked by total downloads -- the most
// popular match leads regardless of *why* it matched. Authors are
// aggregated via plugin_authors so a co-author's search hit counts every
// plugin they're credited on, not just plugins.author_id.
export async function searchPluginsAndAuthors(
  game: string,
  query: string,
  pluginLimit = 6,
  authorLimit = 4,
): Promise<SearchResult> {
  const q = query.trim();
  const pool = getPool();

  if (!q) {
    // Trending counts are fixed regardless of the caller's limit -- the
    // header search always shows "top 5 plugins + top 3 authors" when idle.
    const [plugins, authors] = await Promise.all([
      getTopPlugins("weekly", 5, game),
      getTopAuthors("weekly", 3, game),
    ]);
    return {
      plugins: plugins.map((p) => ({
        id: p.id,
        nameId: p.nameId,
        name: p.name,
        author: p.authorName,
        authorAvatarUrl: p.authorAvatarUrl,
        total: p.value,
      })),
      authors: authors.map((a) => ({
        id: a.authorId,
        nameId: a.nameId,
        name: a.authorName,
        avatarUrl: a.avatarUrl,
        pluginCount: a.pluginCount,
        total: a.value,
      })),
    };
  }

  // Match quality still gates *which* rows qualify (see the WHERE clauses
  // below), but the highest-ranked (most downloaded) match always sorts
  // first within those -- a popular plugin found via its author's name
  // should outrank an obscure exact-name match.
  // Both queries below look up each plugin's latest snapshot via a
  // per-plugin LATERAL (scales with how many plugins actually match the
  // name/author filter -- a handful to a couple thousand) rather than a
  // `DISTINCT ON (plugin_id) ... FROM plugin_snapshots` CTE with no WHERE
  // of its own. The CTE form reads as cleaner SQL, but with no filter to
  // push down it forces Postgres into a full index scan + dedup across
  // *every* snapshot ever recorded (1M+ rows and growing) any time the
  // plugins/authors side of the join isn't selective enough for the
  // planner to invert it into a nested loop on its own -- a broad query
  // (a single common letter) reliably hits that worst case. Measured
  // 332ms/340ms -> ~21ms/27ms against the real dataset switching to
  // LATERAL. See plugin_snapshots_plugin_captured_idx, which every other
  // "latest snapshot for this one plugin" lookup in this file already
  // uses the same way.
  const pluginsResult = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_name, p.author_avatar_url, l.downloads_total AS total
     FROM plugins p
     JOIN LATERAL (
       SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     WHERE p.game = $2
       AND (
         p.name ILIKE '%' || $1 || '%'
         OR EXISTS (
           SELECT 1 FROM plugin_authors pa WHERE pa.plugin_id = p.id AND pa.author_name ILIKE '%' || $1 || '%'
         )
       )
     ORDER BY total DESC
     LIMIT $3`,
    [q, game, pluginLimit],
  );

  const authorsResult = await pool.query(
    `WITH agg AS (
       SELECT pa.author_id, MAX(pa.author_name) AS author_name, MAX(pa.author_avatar_url) AS author_avatar_url,
              COUNT(DISTINCT pa.plugin_id) AS plugin_count, SUM(l.downloads_total) AS total
       FROM plugin_authors pa
       JOIN plugins p ON p.id = pa.plugin_id
       JOIN LATERAL (
         SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) l ON true
       WHERE p.game = $2
       GROUP BY pa.author_id
     )
     SELECT author_id, author_name, author_avatar_url, plugin_count, total
     FROM agg
     WHERE author_name ILIKE '%' || $1 || '%'
     ORDER BY total DESC
     LIMIT $3`,
    [q, game, authorLimit],
  );

  const authorSlugs = await getAuthorSlugMap(game);
  return {
    plugins: pluginsResult.rows.map((row) => ({
      id: row.id,
      nameId: row.name_id,
      name: row.name,
      author: row.author_name,
      authorAvatarUrl: row.author_avatar_url,
      total: Number(row.total),
    })),
    authors: authorsResult.rows.map((row) => ({
      id: row.author_id,
      nameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
      name: row.author_name,
      avatarUrl: row.author_avatar_url,
      pluginCount: Number(row.plugin_count),
      total: Number(row.total),
    })),
  };
}


export interface PluginMeta {
  id: number;
  game: string;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  authorNameId: string;
  authorAvatarUrl: string | null;
  coAuthors: CoAuthor[];
  profileUrl: string;
  tags: string[];
  logoUrl: string | null;
  summary: string;
  ratingsTotal: number;
  ratingsPositive: number;
  ratingsNegative: number;
  ratingsPercentagePositive: number;
  ratingsDisplayText: string;
  dateAdded: string;
  dateUpdated: string;
}

export async function getPluginCoAuthors(pluginId: number, game: string): Promise<CoAuthor[]> {
  const pool = getPool();
  const [{ rows }, authorSlugs] = await Promise.all([
    pool.query(
      `SELECT author_id, author_name, author_avatar_url, author_profile_url
       FROM plugin_authors WHERE plugin_id = $1 ORDER BY position ASC`,
      [pluginId],
    ),
    getAuthorSlugMap(game),
  ]);
  return rows.map((row) => ({
    authorId: row.author_id,
    nameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    name: row.author_name,
    avatarUrl: row.author_avatar_url,
    profileUrl: row.author_profile_url,
  }));
}

export async function getPlugin(pluginId: number): Promise<PluginMeta | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, game, name_id, name, author_id, author_name, author_avatar_url, profile_url, tags, logo_url, summary,
            ratings_total, ratings_positive, ratings_negative, ratings_percentage_positive, ratings_display_text,
            date_added, date_updated
     FROM plugins WHERE id = $1`,
    [pluginId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const [coAuthors, authorSlugs] = await Promise.all([getPluginCoAuthors(pluginId, row.game), getAuthorSlugMap(row.game)]);
  return {
    id: row.id,
    game: row.game,
    nameId: row.name_id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    authorNameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    authorAvatarUrl: row.author_avatar_url,
    coAuthors,
    profileUrl: row.profile_url,
    tags: row.tags ?? [],
    logoUrl: row.logo_url,
    summary: row.summary,
    ratingsTotal: row.ratings_total,
    ratingsPositive: row.ratings_positive,
    ratingsNegative: row.ratings_negative,
    ratingsPercentagePositive: row.ratings_percentage_positive,
    ratingsDisplayText: row.ratings_display_text,
    dateAdded: row.date_added.toISOString(),
    dateUpdated: row.date_updated.toISOString(),
  };
}

export interface PluginInfo extends PluginMeta {
  downloadsTotal: number;
  downloadsToday: number;
  subscribersTotal: number;
  popularityRankPosition: number | null;
}

// Plugin metadata plus just its latest stats -- unlike getPluginTrend,
// which pulls the entire snapshot history, this is a cheap one-row-per-table
// lookup for callers that only want "what are this plugin's numbers right
// now" (a basic-info API, a bot command, etc.) without paying for history
// they're not going to use.
export async function getPluginInfo(pluginId: number): Promise<PluginInfo | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.game, p.name_id, p.name, p.author_id, p.author_name, p.author_avatar_url, p.profile_url, p.tags, p.logo_url, p.summary,
            p.ratings_total, p.ratings_positive, p.ratings_negative, p.ratings_percentage_positive, p.ratings_display_text,
            p.date_added, p.date_updated,
            l.downloads_total, l.downloads_today, l.subscribers_total
     FROM plugins p
     JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     WHERE p.id = $1`,
    [pluginId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  // Computed live via getPluginRanks (same RANK() the leaderboards use)
  // rather than trusting plugin_snapshots.popularity_rank_position --
  // that column is only ever populated from mod.io's own precomputed
  // field (see ingest/modio.ts), and RuneLite plugins have no upstream
  // equivalent, so it's unconditionally null for every RuneLite plugin
  // (ingest/runelite.ts). Computing it ourselves works the same way for
  // both games.
  const [coAuthors, authorSlugs, ranks] = await Promise.all([
    getPluginCoAuthors(pluginId, row.game),
    getAuthorSlugMap(row.game),
    getPluginRanks([pluginId], "alltime", row.game),
  ]);
  return {
    id: row.id,
    game: row.game,
    nameId: row.name_id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    authorNameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    authorAvatarUrl: row.author_avatar_url,
    coAuthors,
    profileUrl: row.profile_url,
    tags: row.tags ?? [],
    logoUrl: row.logo_url,
    summary: row.summary,
    ratingsTotal: row.ratings_total,
    ratingsPositive: row.ratings_positive,
    ratingsNegative: row.ratings_negative,
    ratingsPercentagePositive: row.ratings_percentage_positive,
    ratingsDisplayText: row.ratings_display_text,
    dateAdded: row.date_added.toISOString(),
    dateUpdated: row.date_updated.toISOString(),
    downloadsTotal: Number(row.downloads_total),
    downloadsToday: Number(row.downloads_today),
    subscribersTotal: Number(row.subscribers_total),
    popularityRankPosition: ranks.get(pluginId) ?? null,
  };
}

// Rolled up to one row per UTC calendar day (the trend chart's annotation
// logic -- median-of-±5-*days*, a 7-*day* zoom floor, one calendar cell per
// day -- needs daily granularity), even though ingest actually runs hourly
// and plugin_snapshots is hourly-grain. Each day takes its last snapshot
// strictly before the next day starts -- same "forward-fill the latest
// known value onto each day" pattern as getDailySeriesByPlugin above, just
// for a single plugin and also carrying date_updated through.
//
// The day is pulled out via to_char rather than letting node-postgres parse
// the `date` column itself: pg's default type parser for `date` returns a
// JS Date set to *local* midnight, not UTC midnight, which silently shifts
// the day by one depending on the server's timezone -- the exact bug
// already hit once this session parsing wiki update dates (see
// packages/ingest/src/wikiUpdates.ts). Plain text sidesteps it entirely.
export async function getPluginTrend(pluginId: number): Promise<PluginTrendPoint[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH bounds AS (
       SELECT (min(captured_at) AT TIME ZONE 'UTC')::date AS first_day,
              (max(captured_at) AT TIME ZONE 'UTC')::date AS last_day
       FROM plugin_snapshots WHERE plugin_id = $1
     ),
     days AS (
       SELECT generate_series(first_day, last_day, interval '1 day')::date AS day FROM bounds
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            l.downloads_total, l.downloads_today, l.subscribers_total, l.date_updated
     FROM days d
     JOIN LATERAL (
       SELECT downloads_total, downloads_today, subscribers_total, date_updated
       FROM plugin_snapshots s
       WHERE s.plugin_id = $1 AND (s.captured_at AT TIME ZONE 'UTC') < d.day + interval '1 day'
       ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     ORDER BY d.day`,
    [pluginId],
  );
  return rows.map((row) => ({
    capturedAt: `${row.day}T00:00:00.000Z`,
    downloadsTotal: row.downloads_total,
    downloadsToday: row.downloads_today,
    subscribersTotal: row.subscribers_total,
    dateUpdated: row.date_updated ? row.date_updated.toISOString() : null,
  }));
}

// Raw, un-bucketed snapshots since `sinceIso` -- unlike getPluginTrend's
// one-point-per-day forward-fill (built for 7d/30d/all zoom levels), the
// "Today"/"24h" zoom wants every actual ingest-cadence point so same-day
// movement is visible at all, not collapsed to a single dot.
export async function getPluginTrendRecent(pluginId: number, sinceIso: string): Promise<PluginTrendPoint[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT captured_at, downloads_total, downloads_today, subscribers_total, date_updated
     FROM plugin_snapshots
     WHERE plugin_id = $1 AND captured_at >= $2
     ORDER BY captured_at`,
    [pluginId, sinceIso],
  );
  return rows.map((row) => ({
    capturedAt: row.captured_at.toISOString(),
    downloadsTotal: row.downloads_total,
    downloadsToday: row.downloads_today,
    subscribersTotal: row.subscribers_total,
    dateUpdated: row.date_updated ? row.date_updated.toISOString() : null,
  }));
}

function toPluginRow(row: any, authorSlugs: Map<number, string>): PluginLeaderboardRow {
  return {
    id: row.id,
    nameId: row.name_id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    authorNameId: authorSlugs.get(row.author_id) ?? slugify(row.author_name),
    authorAvatarUrl: row.author_avatar_url,
    profileUrl: row.profile_url,
    tags: row.tags ?? [],
    value: Number(row.value),
    coAuthorNames: row.co_author_names ?? [],
  };
}

export interface AuthorProfileRankInputs {
  hotPlugins: PluginLeaderboardRow[];
  allTimeRanks: Map<number, number>;
  hotRanks: Map<number, number>;
  weeklyRanks: Map<number, number>;
}

// `rankInputs` lets callers that already have (or want to share) these
// game-wide computations pass them in -- see the authors API route, which
// caches them per-game rather than paying for this full-catalog fan-out on
// every author viewed. Callers that don't care (badges, cards, the Discord
// bot, etc.) can omit it and it's computed the same way it always was.
export async function getAuthorProfile(authorId: number, rankInputs?: AuthorProfileRankInputs): Promise<AuthorProfile | null> {
  const pool = getPool();
  // Joined via plugin_authors (not plugins.author_id directly) so a
  // co-author's page picks up every plugin they're credited on, not just
  // ones where they happen to be the primary/first-listed author.
  const { rows } = await pool.query(
    `SELECT p.id, p.game, p.name_id, p.name, p.date_added,
            pa.author_name, pa.author_profile_url, pa.author_avatar_url,
            l.downloads_total, l.downloads_today, l.subscribers_total,
            l.downloads_total - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total) AS weekly_gain
     FROM plugin_authors pa
     JOIN plugins p ON p.id = pa.plugin_id
     JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '7 days'
       ORDER BY s.captured_at DESC LIMIT 1
     ) b1 ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
     ) b2 ON true
     WHERE pa.author_id = $1
     ORDER BY l.downloads_total DESC`,
    [authorId],
  );

  if (rows.length === 0) return null;
  const game = rows[0].game;

  const { hotPlugins, allTimeRanks, hotRanks, weeklyRanks } =
    rankInputs ??
    (await (async () => {
      const [hotPlugins, allTimeRanks, hotRanks, weeklyRanks] = await Promise.all([
        getTopPlugins("hot", 10, game),
        getAuthorRanks([authorId], "alltime", game),
        getAuthorRanks([authorId], "hot", game),
        getAuthorRanks([authorId], "weekly", game),
      ]);
      return { hotPlugins, allTimeRanks, hotRanks, weeklyRanks };
    })());
  const hotPluginIds = new Set(hotPlugins.map((p) => p.id));

  const plugins = rows.map((row) => ({
    id: row.id,
    nameId: row.name_id,
    name: row.name,
    dateAdded: row.date_added.toISOString(),
    downloadsTotal: Number(row.downloads_total),
    weeklyGain: Number(row.weekly_gain),
    subscribersTotal: Number(row.subscribers_total),
    hot: hotPluginIds.has(row.id),
  }));

  return {
    authorId,
    game,
    authorName: rows[0].author_name,
    authorProfileUrl: rows[0].author_profile_url,
    authorAvatarUrl: rows[0].author_avatar_url,
    pluginCount: plugins.length,
    publishingSince: rows.reduce((min, r) => (r.date_added < min ? r.date_added : min), rows[0].date_added).toISOString(),
    totals: {
      downloadsTotal: rows.reduce((sum, r) => sum + Number(r.downloads_total), 0),
      downloadsToday: rows.reduce((sum, r) => sum + Number(r.downloads_today), 0),
      weeklyGain: rows.reduce((sum, r) => sum + Number(r.weekly_gain), 0),
      subscribersTotal: rows.reduce((sum, r) => sum + Number(r.subscribers_total), 0),
    },
    ranks: {
      allTime: allTimeRanks.get(authorId) ?? null,
      hotToday: hotRanks.get(authorId) ?? null,
      hotWeek: weeklyRanks.get(authorId) ?? null,
    },
    plugins,
  };
}

interface DailySeriesPoint {
  date: string;
  total: number;
  today: number;
  subs: number;
}

function daysAgoDate(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function addDaysDate(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 7-day rolling average with a partial window at the start of the series
// (averages over whatever's available for the first 6 days) so short
// histories still render a line instead of starting blank.
function rollingAvg7(values: number[]): number[] {
  const out = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= 7) sum -= values[i - 7];
    out[i] = sum / Math.min(i + 1, 7);
  }
  return out;
}

// Forward-fills each plugin's most recent snapshot onto every day in the
// range (one row per plugin per day, last-value-of-day semantics) so the
// daily totals/today/subs series has no gaps even when ingest runs
// irregularly rather than on a strict daily cron.
async function getDailySeriesByPlugin(
  pluginIds: number[] | null,
  fromDate: Date,
  toDate: Date,
  game = "runescape",
): Promise<Map<number, DailySeriesPoint[]>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
     )
     SELECT d.day, p.id AS plugin_id,
            COALESCE(l.downloads_total, 0) AS downloads_total,
            COALESCE(l.downloads_today, 0) AS downloads_today,
            COALESCE(l.subscribers_total, 0) AS subscribers_total
     FROM days d
     CROSS JOIN plugins p
     LEFT JOIN LATERAL (
       SELECT downloads_total, downloads_today, subscribers_total
       FROM plugin_snapshots s
       WHERE s.plugin_id = p.id AND s.captured_at < d.day + interval '1 day'
       ORDER BY s.captured_at DESC LIMIT 1
     ) l ON true
     WHERE ($3::int[] IS NULL OR p.id = ANY($3::int[])) AND p.game = $4
     ORDER BY p.id, d.day`,
    [toDateKey(fromDate), toDateKey(toDate), pluginIds, game],
  );

  const map = new Map<number, DailySeriesPoint[]>();
  for (const row of rows) {
    const list = map.get(row.plugin_id) ?? [];
    list.push({
      date: toDateKey(row.day),
      total: Number(row.downloads_total),
      today: Number(row.downloads_today),
      subs: Number(row.subscribers_total),
    });
    map.set(row.plugin_id, list);
  }
  return map;
}

// Batch form for the author page's plugin-list sparklines -- one query for
// every one of the author's plugins at once (reusing getDailySeriesByPlugin,
// same as Compare and getFastestGrowingWithSpark below), instead of the N
// separate full-history /api/plugins/{id}/trend requests the page used to
// fan out to (one per plugin, each rebuilding that plugin's entire
// snapshot history just to keep the last `days` points of it).
export async function getPluginSparklines(pluginIds: number[], game: string, days = 20): Promise<Map<number, number[]>> {
  if (pluginIds.length === 0) return new Map();
  const seriesMap = await getDailySeriesByPlugin(pluginIds, daysAgoDate(days - 1), daysAgoDate(0), game);
  const result = new Map<number, number[]>();
  for (const id of pluginIds) {
    result.set(id, (seriesMap.get(id) ?? []).map((p) => p.total));
  }
  return result;
}

function sumDailySeries(lists: DailySeriesPoint[][]): DailySeriesPoint[] {
  const longest = lists.reduce((best, l) => (l.length > best.length ? l : best), lists[0] ?? []);
  return longest.map((point, i) => ({
    date: point.date,
    total: lists.reduce((sum, l) => sum + (l[i]?.total ?? 0), 0),
    today: lists.reduce((sum, l) => sum + (l[i]?.today ?? 0), 0),
    subs: lists.reduce((sum, l) => sum + (l[i]?.subs ?? 0), 0),
  }));
}

function extractMetricSeries(series: DailySeriesPoint[], metric: CompareMetric, padCount = 0): number[] {
  if (metric === "total") return series.slice(padCount).map((p) => p.total);
  if (metric === "subs") return series.slice(padCount).map((p) => p.subs);
  return rollingAvg7(series.map((p) => p.today)).slice(padCount);
}

// The aggregation itself is cheap (tag cloud is at most a few thousand
// rows, grouped in one pass) -- the actual cost this avoids is shipping
// *all* of them to the client on every stats-overview load just to show
// 10 at a time. So we still aggregate the full list in Postgres, then
// paginate in JS before it ever gets serialized into a response body.
async function getAllCategoryStats(game: string): Promise<CategoryStat[]> {
  const pool = getPool();
  // Each plugin's latest/7d-ago/earliest snapshot is resolved once per
  // plugin (plugin_stats below), then tags are unnested from that already-
  // joined result -- unnesting p.tags before the LATERAL joins (the
  // previous shape) re-ran all three per-plugin snapshot lookups once for
  // every tag on a plugin instead of once per plugin, i.e. ~6x redundant
  // work at this catalog's average tag count.
  const { rows } = await pool.query(
    `WITH plugin_stats AS (
       SELECT p.id, p.tags,
              l.downloads_total,
              l.downloads_total - COALESCE(b1.downloads_total, b2.downloads_total, l.downloads_total) AS week_gain
       FROM plugins p
       JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) l ON true
       LEFT JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '7 days'
         ORDER BY s.captured_at DESC LIMIT 1
       ) b1 ON true
       LEFT JOIN LATERAL (
         SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1
       ) b2 ON true
       WHERE p.game = $1
     )
     SELECT tag,
            count(*)::int AS plugin_count,
            SUM(downloads_total)::bigint AS downloads_total,
            SUM(week_gain)::bigint AS week_gain
     FROM plugin_stats, unnest(tags) AS tag
     GROUP BY tag
     ORDER BY downloads_total DESC`,
    [game],
  );
  return rows.map((row) => ({
    name: row.tag,
    pluginCount: row.plugin_count,
    downloadsTotal: Number(row.downloads_total),
    weekGain: Number(row.week_gain),
  }));
}

export async function getCategoryStatsPage(game: string, page: number, pageSize: number): Promise<CategoryStatsPage> {
  const all = await getAllCategoryStats(game);
  const offset = (page - 1) * pageSize;
  return {
    categories: all.slice(offset, offset + pageSize),
    total: all.length,
    maxDownloads: all.length > 0 ? all[0].downloadsTotal : 0,
  };
}

// Growth rate (not raw gain): this week's gain vs the week before it, so a
// small plugin that doubled ranks above a huge plugin with a bigger
// absolute gain. Requires snapshots at both the 7d and 14d marks (i.e. the
// plugin is at least 14 days old) and a previous-week floor of 50
// downloads so brand-new/tiny plugins don't produce absurd percentages.
async function getFastestGrowingWithSpark(limit: number, game: string): Promise<GrowthSparkRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name,
            l.downloads_total AS total_now,
            b7.downloads_total AS total_7,
            b14.downloads_total AS total_14
     FROM plugins p
     JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '7 days'
       ORDER BY s.captured_at DESC LIMIT 1
     ) b7 ON true
     LEFT JOIN LATERAL (
       SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '14 days'
       ORDER BY s.captured_at DESC LIMIT 1
     ) b14 ON true
     WHERE p.game = $1 AND b7.downloads_total IS NOT NULL AND b14.downloads_total IS NOT NULL`,
    [game],
  );

  const candidates = rows
    .map((row) => {
      const thisWeek = Number(row.total_now) - Number(row.total_7);
      const prevWeek = Number(row.total_7) - Number(row.total_14);
      return { row, growthPct: (thisWeek / prevWeek - 1) * 100, prevWeek };
    })
    .filter((c) => c.prevWeek >= 50)
    .sort((a, b) => b.growthPct - a.growthPct)
    .slice(0, limit);

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.row.id);
  const sparkMap = await getDailySeriesByPlugin(ids, daysAgoDate(13), daysAgoDate(0), game);

  return candidates.map((c) => ({
    id: c.row.id,
    nameId: c.row.name_id,
    name: c.row.name,
    authorId: c.row.author_id,
    authorName: c.row.author_name,
    growthPct: Math.round(c.growthPct),
    spark: (sparkMap.get(c.row.id) ?? []).map((p) => p.today),
  }));
}

async function getNewReleases(limit: number, withinDays: number, game: string): Promise<NewReleaseRow[]> {
  const pool = getPool();
  const recentQuery = `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.date_added, l.downloads_total
     FROM plugins p
     JOIN LATERAL (SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
     WHERE p.game = $3 AND p.date_added >= now() - ($2 * interval '1 day')
     ORDER BY p.date_added DESC
     LIMIT $1`;
  let { rows } = await pool.query(recentQuery, [limit, withinDays, game]);

  if (rows.length < 3) {
    ({ rows } = await pool.query(
      `SELECT p.id, p.name_id, p.name, p.author_id, p.author_name, p.date_added, l.downloads_total
       FROM plugins p
       JOIN LATERAL (SELECT downloads_total FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
       WHERE p.game = $2
       ORDER BY p.date_added DESC
       LIMIT $1`,
      [limit, game],
    ));
  }

  return rows.map((row) => ({
    id: row.id,
    nameId: row.name_id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    dateAdded: row.date_added.toISOString(),
    downloadsTotal: Number(row.downloads_total),
  }));
}

// Site-wide per-day totals, summed across every plugin in the game --
// getStatsOverview only ever needs these sums, never a per-plugin
// breakdown, so unlike getDailySeriesByPlugin (used by compare, which
// needs each plugin's own series) this avoids materializing a
// day-by-plugin grid with a correlated "latest snapshot" lookup per cell.
// That grid is O(days * plugins), which stops being cheap once a game has
// thousands of plugins and a 90+ day window; this is O(plugins +
// snapshots-in-range + days) instead -- one lateral lookup per plugin for
// the pre-range seed value, then a plain indexed range scan for in-range
// snapshots, applying each as a delta to a running total.
async function getDailyTotalsAllPlugins(fromDate: Date, toDate: Date, game: string): Promise<{ totalsByDay: number[]; todayByDay: number[] }> {
  const pool = getPool();
  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);
  const padDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;

  const [{ rows: seedRows }, { rows: rangeRows }] = await Promise.all([
    pool.query(
      `SELECT p.id AS plugin_id, s.downloads_total, s.downloads_today
       FROM plugins p
       JOIN LATERAL (
         SELECT downloads_total, downloads_today FROM plugin_snapshots s
         WHERE s.plugin_id = p.id AND s.captured_at < $1::date
         ORDER BY s.captured_at DESC LIMIT 1
       ) s ON true
       WHERE p.game = $2`,
      [fromKey, game],
    ),
    // Filters on s.game (denormalized onto plugin_snapshots specifically
    // for this -- see schema.sql) instead of joining to plugins, so this
    // hits plugin_snapshots_game_captured_idx directly. Joining to plugins
    // here forces a scan across *every* snapshot in the date range
    // regardless of game before the join filters it back down -- measured
    // ~594ms vs ~386ms for a full-year RuneLite range on the real dataset.
    pool.query(
      `SELECT s.plugin_id, s.captured_at::date AS day, s.downloads_total, s.downloads_today
       FROM plugin_snapshots s
       WHERE s.game = $1 AND s.captured_at >= $2::date AND s.captured_at < $3::date + interval '1 day'
       ORDER BY s.captured_at ASC`,
      [game, fromKey, toKey],
    ),
  ]);

  const current = new Map<number, { total: number; today: number }>();
  let runningTotal = 0;
  let runningToday = 0;
  for (const row of seedRows) {
    const total = Number(row.downloads_total);
    const today = Number(row.downloads_today);
    current.set(row.plugin_id, { total, today });
    runningTotal += total;
    runningToday += today;
  }

  const totalsByDay = new Array<number>(padDays).fill(0);
  const todayByDay = new Array<number>(padDays).fill(0);
  let rowIndex = 0;
  for (let dayIndex = 0; dayIndex < padDays; dayIndex++) {
    const dayKey = toDateKey(addDaysDate(fromDate, dayIndex));
    while (rowIndex < rangeRows.length && toDateKey(rangeRows[rowIndex].day) === dayKey) {
      const row = rangeRows[rowIndex];
      const total = Number(row.downloads_total);
      const today = Number(row.downloads_today);
      const prev = current.get(row.plugin_id);
      runningTotal += total - (prev?.total ?? 0);
      runningToday += today - (prev?.today ?? 0);
      current.set(row.plugin_id, { total, today });
      rowIndex++;
    }
    totalsByDay[dayIndex] = runningTotal;
    todayByDay[dayIndex] = runningToday;
  }

  return { totalsByDay, todayByDay };
}

export async function getStatsOverview(rangeDays: 30 | 90 | 365 = 90, game = "runescape"): Promise<StatsOverview> {
  const pool = getPool();
  const padDays = rangeDays + 6; // extra lookback so the 7-day average is warmed up by day one of the visible range
  const fromDate = daysAgoDate(padDays - 1);
  const toDate = daysAgoDate(0);

  const { totalsByDay, todayByDay } = await getDailyTotalsAllPlugins(fromDate, toDate, game);
  const avg7 = rollingAvg7(todayByDay);
  const dates = Array.from({ length: padDays }, (_, i) => toDateKey(addDaysDate(fromDate, i)));

  const visibleFrom = padDays - rangeDays;
  const daily = dates.slice(visibleFrom).map((date, i) => ({
    date,
    downloads: todayByDay[visibleFrom + i],
    avg7: Math.round(avg7[visibleFrom + i]),
  }));

  const latestTotal = totalsByDay[padDays - 1];
  const weekAgoTotal = totalsByDay[Math.max(0, padDays - 8)];
  const latestToday = todayByDay[padDays - 1];
  const avg7Yesterday = avg7[Math.max(0, padDays - 2)];

  const [pluginCounts, fastestGrowing, newReleases, updatedAt] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS plugins,
              count(*) FILTER (WHERE date_added >= now() - interval '30 days')::int AS plugins_new_30d,
              count(DISTINCT author_id)::int AS authors,
              count(DISTINCT author_id) FILTER (WHERE date_added >= now() - interval '30 days')::int AS authors_released_30d
       FROM plugins WHERE game = $1`,
      [game],
    ),
    getFastestGrowingWithSpark(6, game),
    getNewReleases(5, 60, game),
    getLatestSnapshotTime(game),
  ]);
  const counts = pluginCounts.rows[0];

  return {
    updatedAt,
    totals: {
      downloadsTotal: latestTotal,
      downloadsWeek: latestTotal - weekAgoTotal,
      downloadsToday: latestToday,
      avg7Yesterday: Math.round(avg7Yesterday),
      plugins: counts.plugins,
      pluginsNew30d: counts.plugins_new_30d,
      authors: counts.authors,
      authorsReleased30d: counts.authors_released_30d,
    },
    daily,
    fastestGrowing,
    newReleases,
  };
}

function resolveCompareRange(range: CompareRange, startDates: string[]): { fromDate: Date; toDate: Date } {
  const toDate = daysAgoDate(0);
  if (range === "all") {
    const earliest = startDates.length ? new Date(Math.min(...startDates.map((d) => new Date(d).getTime()))) : daysAgoDate(90);
    earliest.setUTCHours(0, 0, 0, 0);
    return { fromDate: earliest, toDate };
  }
  return { fromDate: daysAgoDate(range - 1), toDate };
}

const COMPARE_STATS_FIELDS = `
     p.id, p.game, p.name_id, p.name, p.author_id, p.author_name, p.date_added,
     l.downloads_total AS total_now, l.downloads_today AS today_now, l.subscribers_total AS subs_now,
     COALESCE(b7.downloads_total, b7f.downloads_total, l.downloads_total) AS total_7,
     COALESCE(b30.downloads_total, b30f.downloads_total, l.downloads_total) AS total_30
   FROM plugins p
   JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at DESC LIMIT 1) l ON true
   LEFT JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '7 days' ORDER BY s.captured_at DESC LIMIT 1) b7 ON true
   LEFT JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1) b7f ON true
   LEFT JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id AND s.captured_at <= now() - interval '30 days' ORDER BY s.captured_at DESC LIMIT 1) b30 ON true
   LEFT JOIN LATERAL (SELECT * FROM plugin_snapshots s WHERE s.plugin_id = p.id ORDER BY s.captured_at ASC LIMIT 1) b30f ON true`;

export async function getCompareData(type: CompareType, keys: number[], metric: CompareMetric, range: CompareRange): Promise<CompareResult> {
  const pool = getPool();
  const padCount = metric === "daily" ? 6 : 0;

  if (type === "plugin") {
    const { rows } = await pool.query(`SELECT ${COMPARE_STATS_FIELDS} WHERE p.id = ANY($1::int[])`, [keys]);
    if (rows.length === 0) return { type, metric, from: "", to: "", items: [] };

    const byId = new Map<number, (typeof rows)[number]>(rows.map((r) => [r.id, r]));
    const orderedKeys = keys.filter((k) => byId.has(k));
    const game = byId.get(orderedKeys[0])!.game;
    const [allTimeRanks, hotRanks] = await Promise.all([
      getPluginRanks(orderedKeys, "alltime", game),
      getPluginRanks(orderedKeys, "hot", game),
    ]);

    const { fromDate, toDate } = resolveCompareRange(
      range,
      orderedKeys.map((k) => byId.get(k)!.date_added.toISOString()),
    );
    const fetchFrom = padCount ? addDaysDate(fromDate, -padCount) : fromDate;
    const seriesMap = await getDailySeriesByPlugin(orderedKeys, fetchFrom, toDate, game);

    const items: CompareItem[] = orderedKeys.map((id) => {
      const row = byId.get(id)!;
      return {
        key: id,
        nameId: row.name_id,
        name: row.name,
        sub: `by ${row.author_name}`,
        series: extractMetricSeries(seriesMap.get(id) ?? [], metric, padCount),
        stats: {
          all: Number(row.total_now),
          hot: Number(row.today_now),
          week: Number(row.total_now) - Number(row.total_7),
          month: Number(row.total_now) - Number(row.total_30),
          subs: Number(row.subs_now),
          rank: allTimeRanks.get(id) ?? null,
          hotRank: hotRanks.get(id) ?? null,
          count: null,
          start: row.date_added.toISOString(),
        },
      };
    });

    return { type, metric, from: toDateKey(fromDate), to: toDateKey(toDate), items };
  }

  const { rows: pluginRows } = await pool.query(`SELECT ${COMPARE_STATS_FIELDS} WHERE p.author_id = ANY($1::int[])`, [keys]);
  if (pluginRows.length === 0) return { type, metric, from: "", to: "", items: [] };

  const byAuthor = new Map<number, typeof pluginRows>();
  for (const row of pluginRows) {
    const list = byAuthor.get(row.author_id) ?? [];
    list.push(row);
    byAuthor.set(row.author_id, list);
  }
  const orderedKeys = keys.filter((k) => byAuthor.has(k));
  const startOf = (authorId: number) =>
    byAuthor.get(authorId)!.reduce((min, r) => (r.date_added < min ? r.date_added : min), byAuthor.get(authorId)![0].date_added);
  const game = pluginRows[0].game;

  const [authorRanks, authorSlugs] = await Promise.all([getAuthorRanks(orderedKeys, "alltime", game), getAuthorSlugMap(game)]);
  const rankOfAuthor = (authorId: number) => authorRanks.get(authorId) ?? null;

  const { fromDate, toDate } = resolveCompareRange(
    range,
    orderedKeys.map((k) => startOf(k).toISOString()),
  );
  const fetchFrom = padCount ? addDaysDate(fromDate, -padCount) : fromDate;
  const allPluginIds = pluginRows.map((r) => r.id);
  const seriesMap = await getDailySeriesByPlugin(allPluginIds, fetchFrom, toDate, game);

  const items: CompareItem[] = orderedKeys.map((authorId) => {
    const plugins = byAuthor.get(authorId)!;
    const sumSeries = sumDailySeries(plugins.map((p) => seriesMap.get(p.id) ?? []));
    const all = plugins.reduce((sum, r) => sum + Number(r.total_now), 0);
    const hotVal = plugins.reduce((sum, r) => sum + Number(r.today_now), 0);
    const week = plugins.reduce((sum, r) => sum + (Number(r.total_now) - Number(r.total_7)), 0);
    const month = plugins.reduce((sum, r) => sum + (Number(r.total_now) - Number(r.total_30)), 0);
    const subs = plugins.reduce((sum, r) => sum + Number(r.subs_now), 0);
    return {
      key: authorId,
      nameId: authorSlugs.get(authorId) ?? slugify(plugins[0].author_name),
      name: plugins[0].author_name,
      sub: `${plugins.length} ${plugins.length === 1 ? "plugin" : "plugins"}`,
      series: extractMetricSeries(sumSeries, metric, padCount),
      stats: {
        all,
        hot: hotVal,
        week,
        month,
        subs,
        rank: rankOfAuthor(authorId),
        hotRank: null,
        count: plugins.length,
        start: startOf(authorId).toISOString(),
      },
    };
  });

  return { type, metric, from: toDateKey(fromDate), to: toDateKey(toDate), items };
}

// Resolves a plugin's pretty URL slug (e.g. "117hd") to its numeric id.
// name_id is only unique per game (a handful of names collide across
// mod.io/RuneLite, e.g. "quest-helper"), so game is required here --
// unlike the numeric-id path, which needs no game to be unambiguous.
export async function getPluginIdByNameId(nameId: string, game: string): Promise<number | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id FROM plugins WHERE game = $1 AND name_id = $2`, [game, nameId]);
  if (rows[0]) return rows[0].id;

  // Fall back to a punctuation/whitespace-insensitive match -- "117 hd" or
  // "117_HD" should still resolve to "117hd" the same as a correctly
  // formatted link would, rather than 404ing over a hand-typed URL's
  // formatting alone.
  const target = normalizeSlug(nameId);
  if (!target) return null;
  const { rows: all } = await pool.query(`SELECT id, name_id FROM plugins WHERE game = $1`, [game]);
  return all.find((r) => normalizeSlug(r.name_id) === target)?.id ?? null;
}

// Authors have no stored slug (author info is denormalized across
// plugins/plugin_authors, not a dedicated table), so this resolves a
// pretty URL slug back to an author_id via the same disambiguated map
// (see getAuthorSlugMap) used to hand the slug out in the first place, so
// a slug the API hands out always resolves back to the right author even
// when it was suffixed to break a collision.
export async function getAuthorIdBySlug(slug: string, game: string): Promise<number | null> {
  const authorSlugs = await getAuthorSlugMap(game);
  for (const [authorId, authorSlug] of authorSlugs) {
    if (authorSlug === slug) return authorId;
  }

  // Same punctuation/whitespace-insensitive fallback as plugins -- "jin
  // jiyunsun" (a space, not the canonical hyphen) should still resolve.
  const target = normalizeSlug(slug);
  if (!target) return null;
  for (const [authorId, authorSlug] of authorSlugs) {
    if (normalizeSlug(authorSlug) === target) return authorId;
  }
  return null;
}

// Upserted by wiki_page_id (not title/slug) so a later on-wiki title edit
// updates the existing row instead of creating a duplicate -- see
// packages/ingest/src/wikiUpdates.ts for where these come from.
export async function upsertGameUpdates(updates: GameUpdateInput[]): Promise<number> {
  if (updates.length === 0) return 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const u of updates) {
      await client.query(
        `INSERT INTO game_updates (game, wiki_page_id, title, update_date, url, wiki_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (game, wiki_page_id) DO UPDATE SET
           title = EXCLUDED.title,
           update_date = EXCLUDED.update_date,
           url = EXCLUDED.url,
           wiki_url = EXCLUDED.wiki_url`,
        [u.game, u.wikiPageId, u.title, u.date, u.url, u.wikiUrl],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return updates.length;
}

// Plain id + external key per plugin in a game, for the one-time release
// backfill (packages/ingest/src/backfill-releases.ts) to iterate over --
// "external key" is the mod.io numeric id re-stringified for 'runescape',
// or the plugin-hub internalName (name_id) for 'runelite'.
// dateAdded is the plugin's own upstream "first published" timestamp (mod.io's
// date_added / RuneLite manifest's createdAt -- see plugins.date_added's own
// comment in schema.sql), not a locally-synthesized "when we first saw it" --
// used by the release backfill to anchor a synthetic first release when the
// real tracked history doesn't reach back that far (see backfill-releases.ts).
export async function listPluginIdsForGame(game: string): Promise<{ id: number; nameId: string; dateAdded: string }[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name_id, date_added FROM plugins WHERE game = $1 ORDER BY id`, [game]);
  return rows.map((r) => ({ id: r.id, nameId: r.name_id, dateAdded: r.date_added.toISOString() }));
}

// Upserts on (plugin_id, source, source_key) so re-running the backfill (or
// a later recurring job built on the same fetchers) is a no-op on releases
// it's already seen -- see schema.sql's plugin_releases comment.
export async function upsertPluginReleases(releases: PluginReleaseInput[]): Promise<number> {
  if (releases.length === 0) return 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of releases) {
      await client.query(
        `INSERT INTO plugin_releases (plugin_id, source, source_key, kind, released_at, version, changelog, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (plugin_id, source, source_key) DO UPDATE SET
           kind = EXCLUDED.kind,
           released_at = EXCLUDED.released_at,
           version = EXCLUDED.version,
           changelog = EXCLUDED.changelog,
           url = EXCLUDED.url`,
        [r.pluginId, r.source, r.sourceKey, r.kind, r.releasedAt, r.version, r.changelog, r.url],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return releases.length;
}

export async function getPluginReleases(pluginId: number): Promise<PluginRelease[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, plugin_id, source, kind, released_at, version, changelog, url
     FROM plugin_releases WHERE plugin_id = $1 ORDER BY released_at DESC`,
    [pluginId],
  );
  return rows.map(toPluginRelease);
}

// Batch form for the Compare page (up to 4 plugins at once, see /api/plugins/releases).
export async function getPluginReleasesForIds(pluginIds: number[]): Promise<Map<number, PluginRelease[]>> {
  const map = new Map<number, PluginRelease[]>();
  if (pluginIds.length === 0) return map;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, plugin_id, source, kind, released_at, version, changelog, url
     FROM plugin_releases WHERE plugin_id = ANY($1::int[]) ORDER BY plugin_id, released_at DESC`,
    [pluginIds],
  );
  for (const row of rows) {
    const release = toPluginRelease(row);
    const list = map.get(release.pluginId) ?? [];
    list.push(release);
    map.set(release.pluginId, list);
  }
  return map;
}

function toPluginRelease(r: any): PluginRelease {
  return {
    id: r.id,
    pluginId: r.plugin_id,
    source: r.source,
    kind: r.kind,
    releasedAt: r.released_at.toISOString(),
    version: r.version,
    changelog: r.changelog,
    url: r.url,
  };
}

// Wholesale-replaces special_events from packages/ingest/data/special-
// events.json on every sync (DELETE + reinsert in one transaction) rather
// than upserting by key -- the JSON is hand-edited and small, and is the
// single source of truth for this table, so a renamed/removed entry in the
// file should disappear here too instead of leaving an orphaned row behind.
export async function replaceSpecialEvents(events: SpecialEventInput[]): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM special_events");
    for (const e of events) {
      await client.query(`INSERT INTO special_events (game, title, start_date, end_date, url) VALUES ($1, $2, $3, $4, $5)`, [
        e.game,
        e.title,
        e.start,
        e.end,
        e.url,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return events.length;
}

// RuneLite and OSRS-via-mod.io are the same underlying game, so both read
// the same game_updates/special_events rows -- an incoming "runelite" or
// "osrs" GameKey normalizes to "oldschool" here before querying either
// table, rather than every call site needing to know this.
export function normalizeAnnotationGame(game: string): AnnotationGameKey {
  return game === "runelite" || game === "osrs" ? "oldschool" : (game as AnnotationGameKey);
}

export async function getGameUpdates(game: string, from: string, to: string): Promise<GameUpdate[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, game, title, update_date, url, wiki_url
     FROM game_updates
     WHERE game = $1 AND update_date BETWEEN $2 AND $3
     ORDER BY update_date ASC`,
    [normalizeAnnotationGame(game), from, to],
  );
  return rows.map((row) => ({
    id: row.id,
    game: row.game,
    title: row.title,
    date: row.update_date.toISOString().slice(0, 10),
    url: row.url,
    wikiUrl: row.wiki_url,
  }));
}

// Range-overlap, not a date equality check -- an event starting before
// `from` and still running (or with no end at all) past it still overlaps
// the requested window and should come back.
export async function getSpecialEvents(game: string, from: string, to: string): Promise<SpecialEvent[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, game, title, start_date, end_date, url
     FROM special_events
     WHERE game = $1 AND start_date <= $3 AND (end_date IS NULL OR end_date >= $2)
     ORDER BY start_date ASC`,
    [normalizeAnnotationGame(game), from, to],
  );
  return rows.map((row) => ({
    id: row.id,
    game: row.game,
    title: row.title,
    start: row.start_date.toISOString().slice(0, 10),
    end: row.end_date ? row.end_date.toISOString().slice(0, 10) : null,
    url: row.url,
  }));
}

// "Log in with Discord" sessions (identify + guilds scopes) -- see
// docs/discord-bot.md and the discord_sessions table comment in schema.sql.
function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// One row per login, not one row per Discord user -- a re-login (e.g. a
// second device) just creates another independent session rather than
// invalidating the first, so logging in elsewhere doesn't sign you out
// here. Returns the new session's id, which is what actually goes in the
// cookie.
export async function createDiscordSession(session: {
  discordUserId: string;
  username: string;
  avatarHash: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<string> {
  const pool = getPool();
  const id = generateSessionToken();
  await pool.query(
    `INSERT INTO discord_sessions (id, discord_user_id, username, avatar_hash, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, session.discordUserId, session.username, session.avatarHash, session.accessToken, session.refreshToken, session.expiresAt],
  );
  return id;
}

export async function getDiscordSession(id: string): Promise<DiscordSession | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, discord_user_id, username, avatar_hash, access_token, refresh_token, expires_at FROM discord_sessions WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    discordUserId: row.discord_user_id,
    username: row.username,
    avatarHash: row.avatar_hash,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

// Called after a successful Discord token refresh (access tokens expire
// after ~7 days) so later requests on this same session don't need to
// refresh again until the new token is itself close to expiry.
export async function updateDiscordSessionTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE discord_sessions SET access_token = $2, refresh_token = $3, expires_at = $4 WHERE id = $1`, [
    id,
    accessToken,
    refreshToken,
    expiresAt,
  ]);
}

export async function deleteDiscordSession(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_sessions WHERE id = $1`, [id]);
}

function mapChannelTopicRow(row: {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  entity_kind: "plugin" | "author";
  entity_id: number;
  entity_name: string;
  template: string;
  last_rendered_topic: string | null;
  last_rendered_at: Date | null;
  created_at: Date;
}): DiscordChannelTopic {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    entityName: row.entity_name,
    template: row.template,
    lastRenderedTopic: row.last_rendered_topic,
    lastRenderedAt: row.last_rendered_at,
    createdAt: row.created_at,
  };
}

export async function listChannelTopics(guildId: string): Promise<DiscordChannelTopic[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_channel_topics WHERE guild_id = $1 ORDER BY created_at`, [guildId]);
  return rows.map(mapChannelTopicRow);
}

// One binding per channel -- re-picking a channel that's already bound
// replaces its entity/template rather than erroring or adding a second
// row (see schema.sql's UNIQUE(channel_id)). last_rendered_topic/_at reset
// to NULL on an update so the hourly worker treats an edited binding as
// due for an immediate push next tick, rather than possibly (if the new
// render happens to match what's already on the channel) skipping it.
export async function upsertChannelTopic(input: DiscordChannelTopicInput): Promise<DiscordChannelTopic> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO discord_channel_topics (guild_id, channel_id, channel_name, entity_kind, entity_id, entity_name, template)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (channel_id) DO UPDATE SET
       guild_id = EXCLUDED.guild_id,
       channel_name = EXCLUDED.channel_name,
       entity_kind = EXCLUDED.entity_kind,
       entity_id = EXCLUDED.entity_id,
       entity_name = EXCLUDED.entity_name,
       template = EXCLUDED.template,
       last_rendered_topic = NULL,
       last_rendered_at = NULL
     RETURNING *`,
    [input.guildId, input.channelId, input.channelName, input.entityKind, input.entityId, input.entityName, input.template],
  );
  return mapChannelTopicRow(rows[0]);
}

export async function deleteChannelTopic(guildId: string, channelId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_channel_topics WHERE guild_id = $1 AND channel_id = $2`, [guildId, channelId]);
}

// Every binding across every guild -- for the hourly worker in
// packages/discord-bot, which has no single guildId to scope by.
export async function listAllChannelTopics(): Promise<DiscordChannelTopic[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_channel_topics ORDER BY id`);
  return rows.map(mapChannelTopicRow);
}

export async function markChannelTopicRendered(id: number, renderedTopic: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE discord_channel_topics SET last_rendered_topic = $2, last_rendered_at = now() WHERE id = $1`, [id, renderedTopic]);
}

export const DEFAULT_TOPIC_REFRESH_INTERVAL_HOURS = 5;

export async function getGuildTopicIntervalHours(guildId: string): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT refresh_interval_hours FROM discord_guild_topic_settings WHERE guild_id = $1`, [guildId]);
  return rows[0]?.refresh_interval_hours ?? DEFAULT_TOPIC_REFRESH_INTERVAL_HOURS;
}

export async function setGuildTopicIntervalHours(guildId: string, hours: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO discord_guild_topic_settings (guild_id, refresh_interval_hours, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (guild_id) DO UPDATE SET refresh_interval_hours = EXCLUDED.refresh_interval_hours, updated_at = EXCLUDED.updated_at`,
    [guildId, hours],
  );
}

// For the hourly worker -- one query for every guild's configured interval
// rather than one lookup per binding.
export async function getAllGuildTopicIntervalHours(): Promise<Map<string, number>> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT guild_id, refresh_interval_hours FROM discord_guild_topic_settings`);
  return new Map(rows.map((r) => [r.guild_id as string, r.refresh_interval_hours as number]));
}

function mapGuildAdminRow(row: { id: number; guild_id: string; discord_user_id: string; added_by: string; created_at: Date }): DiscordGuildAdmin {
  return { id: row.id, guildId: row.guild_id, discordUserId: row.discord_user_id, addedBy: row.added_by, createdAt: row.created_at };
}

export async function listGuildAdmins(guildId: string): Promise<DiscordGuildAdmin[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_guild_admins WHERE guild_id = $1 ORDER BY created_at`, [guildId]);
  return rows.map(mapGuildAdminRow);
}

// Doesn't cover the guild's own Discord owner -- that's checked from the
// owner flag Discord's own guild list already carries (see discordAuth.ts),
// not a row in this table. This is only ever "is this user an *explicitly
// promoted* admin".
export async function isGuildAdminRow(guildId: string, discordUserId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT 1 FROM discord_guild_admins WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
  return rows.length > 0;
}

export async function addGuildAdmin(guildId: string, discordUserId: string, addedBy: string): Promise<DiscordGuildAdmin> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO discord_guild_admins (guild_id, discord_user_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET added_by = EXCLUDED.added_by
     RETURNING *`,
    [guildId, discordUserId, addedBy],
  );
  return mapGuildAdminRow(rows[0]);
}

export async function removeGuildAdmin(guildId: string, discordUserId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_guild_admins WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
}

export async function getGuildSubscription(guildId: string): Promise<DiscordGuildSubscription | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_guild_subscriptions WHERE guild_id = $1`, [guildId]);
  if (!rows[0]) return null;
  return { guildId: rows[0].guild_id, grantedBy: rows[0].granted_by, createdAt: rows[0].created_at };
}

export async function grantGuildSubscription(guildId: string, grantedBy: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO discord_guild_subscriptions (guild_id, granted_by) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET granted_by = EXCLUDED.granted_by, created_at = now()`,
    [guildId, grantedBy],
  );
}

export async function revokeGuildSubscription(guildId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_guild_subscriptions WHERE guild_id = $1`, [guildId]);
}

// For the site-wide admin panel's "see data about the discords" view --
// every subscribed guild at once, rather than one getGuildSubscription
// lookup per guild in the bot's guild list.
export async function getAllGuildSubscriptions(): Promise<DiscordGuildSubscription[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_guild_subscriptions`);
  return rows.map((r) => ({ guildId: r.guild_id, grantedBy: r.granted_by, createdAt: r.created_at }));
}

// Same panel's binding-count column -- one grouped query instead of a
// listChannelTopics call per guild.
export async function countChannelTopicsByGuild(): Promise<Map<string, number>> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT guild_id, COUNT(*)::int AS count FROM discord_channel_topics GROUP BY guild_id`);
  return new Map(rows.map((r) => [r.guild_id as string, r.count as number]));
}

function mapSiteAdminRow(row: { id: number; discord_user_id: string; added_by: string; created_at: Date }): SiteAdmin {
  return { id: row.id, discordUserId: row.discord_user_id, addedBy: row.added_by, createdAt: row.created_at };
}

export async function listSiteAdmins(): Promise<SiteAdmin[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM site_admins ORDER BY created_at`);
  return rows.map(mapSiteAdminRow);
}

// Doesn't cover the SITE_OWNER_DISCORD_IDS bootstrap env var -- that's
// checked in packages/api's discordAuth.ts, not here. This is only ever
// "is this user an *explicitly promoted* site-wide mod".
export async function isSiteAdminRow(discordUserId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT 1 FROM site_admins WHERE discord_user_id = $1`, [discordUserId]);
  return rows.length > 0;
}

export async function addSiteAdmin(discordUserId: string, addedBy: string): Promise<SiteAdmin> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO site_admins (discord_user_id, added_by)
     VALUES ($1, $2)
     ON CONFLICT (discord_user_id) DO UPDATE SET added_by = EXCLUDED.added_by
     RETURNING *`,
    [discordUserId, addedBy],
  );
  return mapSiteAdminRow(rows[0]);
}

export async function removeSiteAdmin(discordUserId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM site_admins WHERE discord_user_id = $1`, [discordUserId]);
}

// ---------- Announcements ----------

function mapAnnouncementWatchRow(row: {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  kind: DiscordAnnouncementKind;
  games: string[];
  ping_here: boolean;
  ping_everyone: boolean;
  ping_role_ids: string[];
  ping_role_names: string[];
  show_thumbnail: boolean;
  last_announced_at: Date;
  created_at: Date;
}): DiscordAnnouncementWatch {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    kind: row.kind,
    games: row.games,
    pingHere: row.ping_here,
    pingEveryone: row.ping_everyone,
    pingRoleIds: row.ping_role_ids,
    pingRoleNames: row.ping_role_names,
    showThumbnail: row.show_thumbnail,
    lastAnnouncedAt: row.last_announced_at,
    createdAt: row.created_at,
  };
}

export async function listAnnouncementWatches(guildId: string): Promise<DiscordAnnouncementWatch[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_announcement_watches WHERE guild_id = $1 ORDER BY created_at`, [guildId]);
  return rows.map(mapAnnouncementWatchRow);
}

// For the discord-bot posting tick -- every guild's watches at once,
// same reasoning as listAllChannelTopics.
export async function listAllAnnouncementWatches(): Promise<DiscordAnnouncementWatch[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_announcement_watches ORDER BY id`);
  return rows.map(mapAnnouncementWatchRow);
}

export async function createAnnouncementWatch(input: DiscordAnnouncementWatchInput): Promise<DiscordAnnouncementWatch> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO discord_announcement_watches (guild_id, channel_id, channel_name, kind, games, ping_here, ping_everyone, ping_role_ids, ping_role_names, show_thumbnail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.guildId,
      input.channelId,
      input.channelName,
      input.kind,
      input.games,
      input.pingHere,
      input.pingEveryone,
      input.pingRoleIds,
      input.pingRoleNames,
      input.showThumbnail,
    ],
  );
  return mapAnnouncementWatchRow(rows[0]);
}

export async function updateAnnouncementWatch(guildId: string, id: number, input: DiscordAnnouncementWatchInput): Promise<DiscordAnnouncementWatch | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE discord_announcement_watches
     SET channel_id = $3, channel_name = $4, kind = $5, games = $6, ping_here = $7, ping_everyone = $8, ping_role_ids = $9, ping_role_names = $10, show_thumbnail = $11
     WHERE guild_id = $1 AND id = $2
     RETURNING *`,
    [
      guildId,
      id,
      input.channelId,
      input.channelName,
      input.kind,
      input.games,
      input.pingHere,
      input.pingEveryone,
      input.pingRoleIds,
      input.pingRoleNames,
      input.showThumbnail,
    ],
  );
  return rows[0] ? mapAnnouncementWatchRow(rows[0]) : null;
}

export async function deleteAnnouncementWatch(guildId: string, id: number): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_announcement_watches WHERE guild_id = $1 AND id = $2`, [guildId, id]);
}

export async function markAnnouncementWatchAnnounced(id: number, at: Date): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE discord_announcement_watches SET last_announced_at = $2 WHERE id = $1`, [id, at]);
}

function mapEntityAnnouncementRow(row: {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  entity_kind: DiscordEntityKind;
  entity_id: number;
  entity_name: string;
  kind: DiscordEntityAnnouncementKind;
  ping_here: boolean;
  ping_everyone: boolean;
  ping_role_ids: string[];
  ping_role_names: string[];
  show_thumbnail: boolean;
  last_announced_at: Date;
  created_at: Date;
}): DiscordEntityAnnouncement {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    entityName: row.entity_name,
    kind: row.kind,
    pingHere: row.ping_here,
    pingEveryone: row.ping_everyone,
    pingRoleIds: row.ping_role_ids,
    pingRoleNames: row.ping_role_names,
    showThumbnail: row.show_thumbnail,
    lastAnnouncedAt: row.last_announced_at,
    createdAt: row.created_at,
  };
}

export async function listEntityAnnouncements(guildId: string): Promise<DiscordEntityAnnouncement[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_entity_announcements WHERE guild_id = $1 ORDER BY created_at`, [guildId]);
  return rows.map(mapEntityAnnouncementRow);
}

// For the discord-bot posting tick -- every guild's per-plugin/author
// bindings at once, same reasoning as listAllAnnouncementWatches.
export async function listAllEntityAnnouncements(): Promise<DiscordEntityAnnouncement[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_entity_announcements ORDER BY id`);
  return rows.map(mapEntityAnnouncementRow);
}

// ON CONFLICT on (guild_id, channel_id, entity_kind, entity_id) --
// re-picking the same entity+channel pairing updates its settings in
// place rather than erroring or duplicating, same as
// discord_channel_topics' own upsert.
export async function upsertEntityAnnouncement(input: DiscordEntityAnnouncementInput): Promise<DiscordEntityAnnouncement> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO discord_entity_announcements (guild_id, channel_id, channel_name, entity_kind, entity_id, entity_name, kind, ping_here, ping_everyone, ping_role_ids, ping_role_names, show_thumbnail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (guild_id, channel_id, entity_kind, entity_id) DO UPDATE SET
       entity_name = EXCLUDED.entity_name,
       kind = EXCLUDED.kind,
       ping_here = EXCLUDED.ping_here,
       ping_everyone = EXCLUDED.ping_everyone,
       ping_role_ids = EXCLUDED.ping_role_ids,
       ping_role_names = EXCLUDED.ping_role_names,
       show_thumbnail = EXCLUDED.show_thumbnail
     RETURNING *`,
    [
      input.guildId,
      input.channelId,
      input.channelName,
      input.entityKind,
      input.entityId,
      input.entityName,
      input.kind,
      input.pingHere,
      input.pingEveryone,
      input.pingRoleIds,
      input.pingRoleNames,
      input.showThumbnail,
    ],
  );
  return mapEntityAnnouncementRow(rows[0]);
}

export async function removeEntityAnnouncement(guildId: string, id: number): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM discord_entity_announcements WHERE guild_id = $1 AND id = $2`, [guildId, id]);
}

export async function markEntityAnnouncementAnnounced(id: number, at: Date): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE discord_entity_announcements SET last_announced_at = $2 WHERE id = $1`, [id, at]);
}

// A little more polished than the bare minimum out of the box -- author
// attribution in the description, a game tag in the footer -- so a
// free-tier guild's announcements (which always use these, see
// discord_guild_announcement_embed's "no row = defaults" comment) still
// look considered, not just a placeholder someone's expected to replace.
const DEFAULT_ANNOUNCEMENT_EMBED: Omit<DiscordGuildAnnouncementEmbed, "guildId" | "updatedAt"> = {
  color: "#caa44d",
  titleTemplate: "{verb}: {name}",
  descriptionTemplate: "{name} {verb_lower} on {site}, by {author}.",
  footerTemplate: "{game} plugin",
  showThumbnail: true,
};

// No row = the defaults above (not yet customized) -- same "no row means
// default" convention as discord_guild_topic_settings.
export async function getGuildAnnouncementEmbed(guildId: string): Promise<DiscordGuildAnnouncementEmbed> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM discord_guild_announcement_embed WHERE guild_id = $1`, [guildId]);
  if (!rows[0]) return { guildId, ...DEFAULT_ANNOUNCEMENT_EMBED, updatedAt: new Date(0) };
  const r = rows[0];
  return {
    guildId: r.guild_id,
    color: r.color,
    titleTemplate: r.title_template,
    descriptionTemplate: r.description_template,
    footerTemplate: r.footer_template,
    showThumbnail: r.show_thumbnail,
    updatedAt: r.updated_at,
  };
}

export async function setGuildAnnouncementEmbed(
  guildId: string,
  patch: Omit<DiscordGuildAnnouncementEmbed, "guildId" | "updatedAt">,
): Promise<DiscordGuildAnnouncementEmbed> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO discord_guild_announcement_embed (guild_id, color, title_template, description_template, footer_template, show_thumbnail, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (guild_id) DO UPDATE SET
       color = EXCLUDED.color,
       title_template = EXCLUDED.title_template,
       description_template = EXCLUDED.description_template,
       footer_template = EXCLUDED.footer_template,
       show_thumbnail = EXCLUDED.show_thumbnail,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [guildId, patch.color, patch.titleTemplate, patch.descriptionTemplate, patch.footerTemplate, patch.showThumbnail],
  );
  const r = rows[0];
  return {
    guildId: r.guild_id,
    color: r.color,
    titleTemplate: r.title_template,
    descriptionTemplate: r.description_template,
    footerTemplate: r.footer_template,
    showThumbnail: r.show_thumbnail,
    updatedAt: r.updated_at,
  };
}

// Optional extra scope for the two candidate queries below -- either one
// specific plugin (a Per-plugin/author binding with entityKind 'plugin')
// or every plugin belonging to one specific author (entityKind 'author',
// "announce whenever this author publishes/updates *any* plugin"). Global
// watches pass neither (no filter -- catalog-wide, just game-scoped).
export interface AnnouncementCandidateFilter {
  pluginId?: number;
  authorId?: number;
}

// New plugins since `since` -- for 'release'-kind watches/bindings.
// plugins.date_added is upstream's own "first published" timestamp (see
// listPluginIdsForGame's comment), close enough to "when we discovered
// it" in practice since ingest runs hourly; what actually prevents a
// backlog flood when a watch is first turned on is its own
// last_announced_at cursor (defaulted to creation time), not this query.
export async function getNewPluginCandidates(since: Date, games: string[], filter?: AnnouncementCandidateFilter): Promise<AnnouncementCandidate[]> {
  const pool = getPool();
  const params: unknown[] = [since, games];
  let extraCondition = "";
  if (filter?.pluginId !== undefined) {
    params.push(filter.pluginId);
    extraCondition = `AND id = $${params.length}`;
  } else if (filter?.authorId !== undefined) {
    params.push(filter.authorId);
    extraCondition = `AND author_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, name_id, name, game, author_name, author_avatar_url, profile_url, logo_url, date_added
     FROM plugins
     WHERE date_added > $1 AND game = ANY($2) ${extraCondition}
     ORDER BY date_added ASC`,
    params,
  );
  return rows.map((r) => ({
    kind: "release" as const,
    pluginId: r.id,
    pluginName: r.name,
    pluginNameId: r.name_id,
    game: r.game,
    authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    profileUrl: r.profile_url,
    logoUrl: r.logo_url,
    occurredAt: r.date_added,
    version: null,
    changelog: null,
    releaseUrl: null,
  }));
}

// Genuine version updates since `since` -- for 'update'-kind
// watches/bindings. Excludes the synthesized "first-seen" row
// (firstSeenRelease.ts), anything within a day of the plugin's own
// date_added (that's the plugin's debut release landing in
// plugin_releases, already covered by getNewPluginCandidates above, not
// a second thing to announce), and 'unavailable' rows (a plugin-hub
// listing getting pulled, not a real version -- see schema.sql's
// plugin_releases comment).
export async function getPluginUpdateCandidates(since: Date, games: string[], filter?: AnnouncementCandidateFilter): Promise<AnnouncementCandidate[]> {
  const pool = getPool();
  const params: unknown[] = [since, games];
  let extraCondition = "";
  if (filter?.pluginId !== undefined) {
    params.push(filter.pluginId);
    extraCondition = `AND p.id = $${params.length}`;
  } else if (filter?.authorId !== undefined) {
    params.push(filter.authorId);
    extraCondition = `AND p.author_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.name, p.game, p.author_name, p.author_avatar_url, p.profile_url, p.logo_url,
            pr.released_at, pr.version, pr.changelog, pr.url
     FROM plugin_releases pr
     JOIN plugins p ON p.id = pr.plugin_id
     WHERE pr.released_at > $1
       AND p.game = ANY($2)
       AND pr.kind = 'update'
       AND pr.source_key != 'first-seen'
       AND pr.released_at > p.date_added + INTERVAL '1 day'
       ${extraCondition}
     ORDER BY pr.released_at ASC`,
    params,
  );
  return rows.map((r) => ({
    kind: "update" as const,
    pluginId: r.id,
    pluginName: r.name,
    pluginNameId: r.name_id,
    game: r.game,
    authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    profileUrl: r.profile_url,
    logoUrl: r.logo_url,
    occurredAt: r.released_at,
    version: r.version,
    changelog: r.changelog,
    releaseUrl: r.url,
  }));
}

// For the hourly targeted release-detail check (packages/ingest's
// run-release-ingest-hourly.ts) -- plugins whose date_updated has moved
// past the latest release row already recorded for them (or that have no
// release rows at all yet) are the ones worth spending an expensive
// per-plugin release-detail fetch on, instead of re-scanning the entire
// catalog every hour the way the weekly full reconciliation
// (run-release-ingest.ts) does. Derived entirely from existing columns --
// no new tracking state needed.
export async function listPluginsNeedingReleaseCheck(game: string): Promise<{ id: number; nameId: string; dateAdded: string }[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.name_id, p.date_added
     FROM plugins p
     LEFT JOIN (SELECT plugin_id, MAX(released_at) AS latest FROM plugin_releases GROUP BY plugin_id) r ON r.plugin_id = p.id
     WHERE p.game = $1 AND p.date_updated > COALESCE(r.latest, p.date_added - INTERVAL '1 day')
     ORDER BY p.id`,
    [game],
  );
  return rows.map((r) => ({ id: r.id, nameId: r.name_id, dateAdded: r.date_added.toISOString() }));
}
