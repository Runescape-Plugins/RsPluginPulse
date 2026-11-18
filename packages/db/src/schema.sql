-- RuneScape PluginPulse schema.
-- Keyed by mod.io's mod id, which is stable and never reassigned.
-- Author info (name, profile url, avatar) is denormalized onto plugins
-- rather than a separate authors table, since mod.io has no stable
-- per-author endpoint here -- author pages are built by aggregating
-- across the plugins rows that share an author_id.

CREATE TABLE IF NOT EXISTS plugins (
  id INTEGER PRIMARY KEY,
  name_id TEXT NOT NULL,
  name TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_profile_url TEXT NOT NULL DEFAULT '',
  author_avatar_url TEXT,
  profile_url TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  logo_url TEXT,
  summary TEXT NOT NULL DEFAULT '',
  ratings_total INTEGER NOT NULL DEFAULT 0,
  ratings_positive INTEGER NOT NULL DEFAULT 0,
  ratings_negative INTEGER NOT NULL DEFAULT 0,
  ratings_percentage_positive INTEGER NOT NULL DEFAULT 0,
  ratings_display_text TEXT NOT NULL DEFAULT '',
  date_added TIMESTAMPTZ NOT NULL,
  date_updated TIMESTAMPTZ NOT NULL
);

ALTER TABLE plugins ADD COLUMN IF NOT EXISTS author_profile_url TEXT NOT NULL DEFAULT '';
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS author_avatar_url TEXT;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS ratings_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS ratings_positive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS ratings_negative INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS ratings_percentage_positive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS ratings_display_text TEXT NOT NULL DEFAULT '';

-- Multi-game support. 'runescape' (mod.io) is the original/default scope;
-- new games (e.g. 'runelite') live in the same tables so the API and site
-- logic stay identical and only filter by this column. mod.io's plugin
-- and author ids are real upstream integers; non-mod.io games mint their
-- own surrogate integer ids (see external_id_map below) so every existing
-- `Number(id)`-based route/page keeps working unmodified.
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'runescape';

-- Renamed from the original 'rs3' key -- idempotent (a no-op once every
-- row has already been migrated), safe to leave in permanently rather
-- than adding a one-off migration script for it.
UPDATE plugins SET game = 'runescape' WHERE game = 'rs3';
ALTER TABLE plugins ALTER COLUMN game SET DEFAULT 'runescape';

CREATE INDEX IF NOT EXISTS plugins_game_idx ON plugins (game);

-- getPluginIdByNameId's hot path (WHERE game = $1 AND name_id = $2) --
-- every plugin page/card/badge resolves its URL slug through this query,
-- and without a composite index it can only narrow down via
-- plugins_game_idx above, then filter name_id row by row. Not UNIQUE: a
-- plain idempotent CREATE INDEX can't fail a migration run even if some
-- future data quality issue ever produced a duplicate (game, name_id)
-- pair, unlike a unique index, which would throw and break the whole
-- schema.sql batch for everyone.
CREATE INDEX IF NOT EXISTS plugins_game_name_id_idx ON plugins (game, name_id);

-- getNewestPlugins/getNewReleases filter by game then ORDER BY date_added
-- DESC -- without this, that sort has no index to lean on once narrowed to
-- one game.
CREATE INDEX IF NOT EXISTS plugins_game_date_added_idx ON plugins (game, date_added DESC);

-- Backs the author-filtered lookups in getCompareData (`p.author_id =
-- ANY($1)`) and getPluginUpdateCandidates' per-author filter -- same
-- reasoning as plugin_authors_author_idx below, but for the denormalized
-- column on plugins itself.
CREATE INDEX IF NOT EXISTS plugins_author_id_idx ON plugins (author_id);

-- Stable integer ids for entities that don't have a native numeric id
-- upstream (e.g. RuneLite plugins keyed by internalName, authors keyed by
-- GitHub login). Minted once per (game, kind, external_key) and reused on
-- every later ingest run so history keeps lining up against the same id.
CREATE SEQUENCE IF NOT EXISTS external_id_seq START WITH 900000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS external_id_map (
  game TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  id INTEGER NOT NULL,
  PRIMARY KEY (game, kind, external_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS external_id_map_id_idx ON external_id_map (kind, id);

-- Full contributor roster per plugin (mod.io always has exactly one row
-- here; RuneLite's plugin-hub manifest sometimes credits several people in
-- one free-text field, each of which gets their own row -- and their own
-- author id -- so they each get a real, individual author page rather
-- than being squashed into a single denormalized `plugins.author_*` row).
-- `plugins.author_id`/`author_name`/etc. stay as the first (primary)
-- entry here, purely so every existing primary-author-only query keeps
-- working unchanged.
CREATE TABLE IF NOT EXISTS plugin_authors (
  plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar_url TEXT,
  author_profile_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plugin_id, author_id)
);

CREATE INDEX IF NOT EXISTS plugin_authors_author_idx ON plugin_authors (author_id);

-- Backs searchPluginsAndAuthors' `name/author_name ILIKE '%...%'` --
-- without a trigram index those are sequential scans on every keystroke,
-- since a leading wildcard can't use a plain btree.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS plugins_name_trgm_idx ON plugins USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS plugin_authors_author_name_trgm_idx ON plugin_authors USING GIN (author_name gin_trgm_ops);

-- One row per plugin per ingest run. captured_at is shared across every
-- plugin in a single run so windowed queries compare like-for-like.
CREATE TABLE IF NOT EXISTS plugin_snapshots (
  plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  downloads_total INTEGER NOT NULL,
  downloads_today INTEGER NOT NULL,
  subscribers_total INTEGER NOT NULL,
  popularity_rank_position INTEGER,
  PRIMARY KEY (plugin_id, captured_at)
);

-- The plugin's own upstream "last updated" timestamp at the time of this
-- snapshot, so trend charts can mark when the plugin itself was released/
-- updated (not a game update) by diffing consecutive snapshots' values --
-- see getPluginTrend. NULL on every snapshot taken before this column
-- existed, so that detection only ever works from here forward, never
-- retroactively.
ALTER TABLE plugin_snapshots ADD COLUMN IF NOT EXISTS date_updated TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS plugin_snapshots_captured_at_idx
  ON plugin_snapshots (captured_at);

-- Denormalized from plugins.game (populated on every insert -- see
-- upsertPluginsAndSnapshot) purely so "latest snapshot for game X" can hit
-- an index on this table directly. Without it, that query has to join the
-- whole table against plugins to filter by game, which turns into a seq
-- scan once plugin_snapshots passes a few hundred thousand rows -- it's
-- well past a million now.
ALTER TABLE plugin_snapshots ADD COLUMN IF NOT EXISTS game TEXT;

UPDATE plugin_snapshots s SET game = p.game
  FROM plugins p WHERE p.id = s.plugin_id AND s.game IS NULL;

-- Same 'rs3' -> 'runescape' rename as plugins.game above -- this one
-- already had a value (backfilled, not NULL) before the rename, so it
-- needs its own explicit pass rather than relying on the IS NULL backfill.
UPDATE plugin_snapshots SET game = 'runescape' WHERE game = 'rs3';

CREATE INDEX IF NOT EXISTS plugin_snapshots_game_captured_idx
  ON plugin_snapshots (game, captured_at DESC);

CREATE INDEX IF NOT EXISTS plugin_snapshots_plugin_captured_idx
  ON plugin_snapshots (plugin_id, captured_at DESC);

-- Short links for the embeddable stats card (/api/card/{id}.svg), so an
-- embed URL carries an id instead of a theme/spark/etc query string.
-- Settings are looked up by id; identical combos reuse the same row
-- instead of minting a new short id every time.
CREATE TABLE IF NOT EXISTS embed_cards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  theme TEXT NOT NULL DEFAULT 'dark',
  spark BOOLEAN NOT NULL DEFAULT true,
  spark_days INTEGER NOT NULL DEFAULT 30,
  show_subtitle BOOLEAN NOT NULL DEFAULT true,
  show_hot BOOLEAN NOT NULL DEFAULT true,
  show_stat_downloads BOOLEAN NOT NULL DEFAULT true,
  show_stat_week BOOLEAN NOT NULL DEFAULT true,
  show_stat_third BOOLEAN NOT NULL DEFAULT true,
  show_footer BOOLEAN NOT NULL DEFAULT true,
  show_image BOOLEAN NOT NULL DEFAULT true,
  accent_color TEXT NOT NULL DEFAULT '',
  bg_color TEXT NOT NULL DEFAULT '',
  text_color TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS spark_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_subtitle BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_hot BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_stat_downloads BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_stat_week BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_stat_third BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_footer BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS show_image BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '';
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS bg_color TEXT NOT NULL DEFAULT '';
ALTER TABLE embed_cards ADD COLUMN IF NOT EXISTS text_color TEXT NOT NULL DEFAULT '';
-- Old column from before per-stat toggles existed; no longer written or read.
ALTER TABLE embed_cards DROP COLUMN IF EXISTS show_stats;

DROP INDEX IF EXISTS embed_cards_combo_idx;
CREATE UNIQUE INDEX IF NOT EXISTS embed_cards_combo_idx
  ON embed_cards (
    type, entity_id, theme, spark, spark_days, show_subtitle, show_hot,
    show_stat_downloads, show_stat_week, show_stat_third, show_footer, show_image,
    accent_color, bg_color, text_color
  );

-- Official game-update news posts, scraped weekly from the RuneScape wikis'
-- Category:Game updates listings (see packages/ingest/src/wikiUpdates.ts).
-- Surfaced on plugin trend charts as reference markers so a download spike
-- or crash can be explained instead of just observed. Keyed by the wiki's
-- own page id (not a slug) so a later title edit on-wiki doesn't orphan the
-- row -- (game, wiki_page_id) is upserted in place instead.
CREATE TABLE IF NOT EXISTS game_updates (
  id SERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  wiki_page_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  update_date DATE NOT NULL,
  url TEXT NOT NULL,
  wiki_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game, wiki_page_id)
);

CREATE INDEX IF NOT EXISTS game_updates_game_date_idx ON game_updates (game, update_date);

-- Hand-curated date ranges (Leagues seasons, Fresh Start Worlds, betas,
-- etc.) worth flagging on trend charts, from packages/ingest/data/special-
-- events.json -- see that file's README. No unique key / upsert here: the
-- JSON is the source of truth and small (a handful of rows), so every sync
-- just wholesale-replaces this table's contents (see
-- replaceSpecialEvents in queries.ts) rather than tracking per-row
-- identity across edits/renames.
CREATE TABLE IF NOT EXISTS special_events (
  id SERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE special_events ADD COLUMN IF NOT EXISTS url TEXT;

CREATE INDEX IF NOT EXISTS special_events_game_idx ON special_events (game, start_date);

-- Per-plugin release/version history, backfilled once from each game's real
-- upstream source (see packages/ingest/src/backfill-releases.ts) rather than
-- only observed forward-in-time like plugin_snapshots.date_updated:
--   - runescape (mod.io): each mod's /files entries (one per uploaded build).
--   - runelite (plugin-hub): each commit touching plugins/<name> in the
--     runelite/plugin-hub GitHub repo (one per hub re-packaging).
-- source_key is the upstream id for that one release (mod.io file id, or
-- the hub commit sha) so re-running the backfill is a no-op on rows it's
-- already seen, and a later recurring job can safely pick up only new ones.
CREATE TABLE IF NOT EXISTS plugin_releases (
  id SERIAL PRIMARY KEY,
  plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL,
  version TEXT,
  changelog TEXT,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plugin_id, source, source_key)
);

-- The plugin-hub bot has non-content commits ("disable X"/"unavailable X")
-- that pull a broken plugin from the hub listing, not a real version update
-- -- still worth recording (so "unavailable -> available again" is
-- reconstructable later) but not something a trend chart should show as a
-- Release/Update marker. mod.io releases are always 'update' -- every
-- uploaded file there is a real version. See packages/ingest/src/
-- pluginHubReleases.ts for how 'unavailable' gets classified.
ALTER TABLE plugin_releases ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'update';

-- "Log in with Discord" sessions for the /discord dashboard (identify +
-- guilds scopes -- a separate OAuth2 flow from the bot-install "Add to
-- Discord" one, see docs/discord-bot.md). id is the opaque random token
-- that lives in the session cookie; looking it up is the only way to read
-- a row, so there's no need to encrypt the Discord tokens at rest beyond
-- normal DB access control. access_token is used to list the user's own
-- guilds; refresh_token lets that keep working past the ~7 day access
-- token expiry without forcing a re-login.
CREATE TABLE IF NOT EXISTS discord_sessions (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_hash TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discord_sessions_user_idx ON discord_sessions (discord_user_id);

CREATE INDEX IF NOT EXISTS plugin_releases_plugin_idx ON plugin_releases (plugin_id, released_at);

-- getPluginUpdateCandidates' guild-wide-watch path (no plugin_id/author_id
-- filter) scans by released_at + kind='update' alone -- plugin_releases_
-- plugin_idx above is useless without a plugin_id predicate, so this is a
-- partial index on just the rows that path ever matches.
CREATE INDEX IF NOT EXISTS plugin_releases_update_released_at_idx ON plugin_releases (released_at) WHERE kind = 'update';

-- Per-guild channel-topic bindings (docs/discord-bot.md's "Channel
-- description templates"): an admin picks a plugin or author and a
-- template string for one channel, re-rendered hourly by
-- packages/discord-bot (same cadence as ingest) and pushed via Discord's
-- "modify channel" endpoint. channel_id alone is UNIQUE (not a composite
-- with guild_id) because Discord snowflakes are already globally unique,
-- and a channel only has one topic -- binding a new entity/template to an
-- already-bound channel replaces it rather than adding a second one.
-- last_rendered_topic/last_rendered_at let the worker skip a channel whose
-- rendered topic hasn't actually changed since last time, instead of
-- retry-storming Discord's channel-edit rate limit every tick.
CREATE TABLE IF NOT EXISTS discord_channel_topics (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('plugin', 'author')),
  entity_id INTEGER NOT NULL,
  entity_name TEXT NOT NULL,
  template TEXT NOT NULL,
  last_rendered_topic TEXT,
  last_rendered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discord_channel_topics_guild_idx ON discord_channel_topics (guild_id);

-- Per-guild channel-topic refresh cadence -- free tier is fixed at the
-- default (5h), subscribers can drop it to as low as 1h (see
-- packages/api/src/lib/subscriptions.ts). A faster interval means more
-- frequent getPluginInfo/getAuthorProfile reads from packages/discord-bot's
-- hourly worker, which is exactly why it's gated rather than free for
-- everyone. No row = use the default; only written when someone actually
-- changes it away from that.
CREATE TABLE IF NOT EXISTS discord_guild_topic_settings (
  guild_id TEXT PRIMARY KEY,
  refresh_interval_hours INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-guild dashboard admins -- a step up from the ordinary Manage Server
-- gate every /discord route already requires (see discordAuth.ts's
-- requireManageableGuild): plenty of people can have Manage Server on a
-- big server without the owner wanting them to see/manage its other
-- admins or force-push channel topics. The guild's own Discord owner is
-- always implicitly an admin too (checked via Discord's own `owner` flag,
-- not a row here) -- this table only holds the *extra* admins someone's
-- been explicitly promoted to. added_by records which admin (or the
-- owner) granted it, purely for the admin panel's own "who added this"
-- display. This whole per-guild panel is itself gated behind the guild's
-- own subscription (see discord_guild_subscriptions below) -- granting
-- the subscription in the first place is the *site-wide* admin panel's
-- job (site_admins below), not this table's.
CREATE TABLE IF NOT EXISTS discord_guild_admins (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS discord_guild_admins_guild_idx ON discord_guild_admins (guild_id);

-- Site-wide mods -- a different, higher tier than discord_guild_admins
-- above: those are scoped to one guild and granted by that guild's own
-- owner; these are the *site* owner's own staff, with visibility and
-- control across every guild the bot's in. The bootstrap owner(s) are an
-- env var (SITE_OWNER_DISCORD_IDS, checked in discordAuth.ts, never a row
-- here) so there's no chicken-and-egg problem for who grants the very
-- first mod -- everyone added after that is a row in this table, with the
-- exact same global powers: see every guild the bot's in, grant/revoke
-- any guild's subscription. Reached from the profile dropdown's "Admin
-- Management" entry, not from any one guild's own settings.
CREATE TABLE IF NOT EXISTS site_admins (
  id SERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mod-granted subscription per guild -- there's no real billing yet (see
-- packages/db/src/subscriptions.ts), so until there is, this is the
-- actual entitlement mechanism. Only ever written by the site-wide admin
-- panel (a site_admins mod, or the SITE_OWNER_DISCORD_IDS bootstrap) --
-- *not* self-service by a guild's own discord_guild_admins, which is the
-- thing this gates, not the thing that grants itself. A row existing
-- means subscribed; granted_by is who flipped it on, purely for display.
CREATE TABLE IF NOT EXISTS discord_guild_subscriptions (
  guild_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Announcements -- the Global tab's rows (docs/discord-bot.md's
-- "Notifications" section): a flexible list, not fixed slots -- a guild
-- can have as many of these as it wants (e.g. one channel for RuneScape
-- releases, another for RuneLite updates, another posting both kinds to
-- a general channel). `kind` is which event this row fires on; `games`
-- filters which catalog(s) it applies to. last_announced_at is a cursor
-- (same pattern as discord_channel_topics' last_rendered_at) -- defaults
-- to the row's own creation time so turning a watch on never retroactively
-- floods the channel with everything that happened before it existed;
-- advanced forward after each successful post so nothing gets announced
-- twice. Per-plugin/author bindings (discord_entity_announcements below) are
-- additive, not a replacement -- a plugin matching both a global rule and
-- having its own per-plugin binding gets posted to *both* channels.
--
-- Ping is three independent signals, not one mutually-exclusive mode:
-- ping_here/ping_everyone (mutually exclusive with *each other* --
-- there's no point pinging both, @everyone already covers @here -- but
-- NOT with ping_role_ids) can be combined with any set of roles, e.g.
-- "@here plus @Moderators" in the same post. Discord's own
-- allowed_mentions API already supports this combination natively.
CREATE TABLE IF NOT EXISTS discord_announcement_watches (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('release', 'update')),
  games TEXT[] NOT NULL DEFAULT ARRAY['runescape', 'runelite'],
  ping_here BOOLEAN NOT NULL DEFAULT false,
  ping_everyone BOOLEAN NOT NULL DEFAULT false,
  ping_role_ids TEXT[] NOT NULL DEFAULT '{}',
  ping_role_names TEXT[] NOT NULL DEFAULT '{}',
  show_thumbnail BOOLEAN NOT NULL DEFAULT true,
  last_announced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (ping_here AND ping_everyone))
);

CREATE INDEX IF NOT EXISTS discord_announcement_watches_guild_idx ON discord_announcement_watches (guild_id);

-- The Per-plugin/author tab's rows -- same idea as discord_channel_topics
-- (entity_kind/entity_id/entity_name, either a specific plugin or a
-- specific author), but for announcements instead of a channel topic:
-- "also post updates/the debut of *this specific* plugin (or *any*
-- plugin by this specific author) into *this specific* channel",
-- independent of (and additive to) any Global watch rule that also
-- happens to match it. No FK to plugins(id)/authors -- same convention
-- as discord_channel_topics' entity_id, a plain int reference.
CREATE TABLE IF NOT EXISTS discord_entity_announcements (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('plugin', 'author')),
  entity_id INTEGER NOT NULL,
  entity_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('release', 'update', 'both')),
  ping_here BOOLEAN NOT NULL DEFAULT false,
  ping_everyone BOOLEAN NOT NULL DEFAULT false,
  ping_role_ids TEXT[] NOT NULL DEFAULT '{}',
  ping_role_names TEXT[] NOT NULL DEFAULT '{}',
  show_thumbnail BOOLEAN NOT NULL DEFAULT true,
  last_announced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, channel_id, entity_kind, entity_id),
  CHECK (NOT (ping_here AND ping_everyone))
);

CREATE INDEX IF NOT EXISTS discord_entity_announcements_guild_idx ON discord_entity_announcements (guild_id);
CREATE INDEX IF NOT EXISTS discord_entity_announcements_entity_idx ON discord_entity_announcements (entity_kind, entity_id);

-- The Embed builder tab's per-guild config -- one row per guild, same
-- shape as discord_guild_topic_settings (no row = defaults). Gated
-- behind the guild's subscription (see subscriptions.ts) same as
-- Advanced Settings -- a free-tier guild's announcements still post,
-- just with these defaults rather than a customized look.
CREATE TABLE IF NOT EXISTS discord_guild_announcement_embed (
  guild_id TEXT PRIMARY KEY,
  color TEXT NOT NULL DEFAULT '#caa44d',
  title_template TEXT NOT NULL DEFAULT '{verb}: {name}',
  description_template TEXT NOT NULL DEFAULT '{name} {verb_lower} on {site}, by {author}.',
  footer_template TEXT NOT NULL DEFAULT '{game} plugin',
  show_thumbnail BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discord-account-to-author links ("Linked authors" dashboard tab, see
-- docs/discord-bot.md's "Account linking" section) -- the first table in
-- this file that's deliberately *not* per-guild: a Discord user's author
-- identity doesn't change between servers, so one link covers every guild
-- the bot shares with them (the "Linked authors" tab filters this down to
-- just the current guild's members live via the Discord API, rather than
-- storing a guild_id here). Low-friction/trust-based, same as the doc's
-- chosen "ship the simple version first" option -- /link just takes the
-- member's word for it, since this only grants *read* access to numbers
-- that are already public via /author. One row per (discord_user_id,
-- game): a user can link a RuneScape (mod.io) identity, a RuneLite
-- identity, or both independently, since the two catalogs have entirely
-- separate author id spaces.
CREATE TABLE IF NOT EXISTS discord_author_links (
  id SERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('runescape', 'runelite')),
  author_id INT NOT NULL,
  author_name TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discord_user_id, game)
);
CREATE INDEX IF NOT EXISTS discord_author_links_user_idx ON discord_author_links (discord_user_id);

-- Per-server command toggles (docs/discord-bot.md's "Per-server command
-- toggles" section), checked by the bot's own interactionCreate handler
-- before running a command (packages/discord-bot/src/index.ts) and
-- written from the dashboard's Commands tab. "Missing = on": a row here
-- means that command is *disabled* for that guild, rather than storing
-- an enabled/disabled boolean per command per guild -- a freshly invited
-- guild (no rows at all) gets every command enabled by default with
-- nothing to seed, and re-enabling a command is just deleting its row.
CREATE TABLE IF NOT EXISTS discord_command_toggles (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  UNIQUE (guild_id, command_name)
);
CREATE INDEX IF NOT EXISTS discord_command_toggles_guild_idx ON discord_command_toggles (guild_id);
