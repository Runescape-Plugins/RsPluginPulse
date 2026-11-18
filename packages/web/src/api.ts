import type { Game } from "./context/GameContext";

export type Period = "alltime" | "hot" | "weekly" | "monthly";

export interface PluginLeaderboardRow {
  id: number;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  authorNameId: string;
  authorAvatarUrl: string | null;
  profileUrl: string;
  tags: string[];
  value: number;
  coAuthorNames: string[];
}

export interface AuthorLeaderboardRow {
  authorId: number;
  authorName: string;
  nameId: string;
  avatarUrl: string | null;
  pluginCount: number;
  value: number;
}

export interface SearchPluginRow {
  id: number;
  nameId: string;
  name: string;
  author: string;
  authorAvatarUrl: string | null;
  total: number;
}

export interface SearchAuthorRow {
  id: number;
  nameId: string;
  name: string;
  avatarUrl: string | null;
  pluginCount: number;
  total: number;
}

export interface SearchResult {
  plugins: SearchPluginRow[];
  authors: SearchAuthorRow[];
}

export interface FastestGrowingPlugin {
  id: number;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  authorNameId: string;
  profileUrl: string;
  downloadsTotal: number;
  subscribersTotal: number;
  downloadsGain: number;
  subscribersGain: number;
  downloadsGrowthPct: number;
  growthScore: number;
  coAuthorNames: string[];
}

export interface PluginTrendPoint {
  capturedAt: string;
  downloadsTotal: number;
  downloadsToday: number;
  subscribersTotal: number;
  dateUpdated: string | null;
}

export interface GameUpdate {
  id: number;
  game: Game;
  title: string;
  date: string;
  url: string;
  wikiUrl: string;
}

export interface SpecialEvent {
  id: number;
  game: Game;
  title: string;
  start: string;
  end: string | null;
  url: string | null;
}

export interface CoAuthor {
  authorId: number;
  nameId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string | null;
}

export interface PluginMeta {
  id: number;
  game: Game;
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

export interface AuthorProfilePlugin {
  id: number;
  nameId: string;
  name: string;
  dateAdded: string;
  downloadsTotal: number;
  weeklyGain: number;
  subscribersTotal: number;
  hot: boolean;
}

export interface AuthorProfile {
  authorId: number;
  game: Game;
  authorName: string;
  authorProfileUrl: string;
  authorAvatarUrl: string | null;
  pluginCount: number;
  publishingSince: string;
  totals: {
    downloadsTotal: number;
    downloadsToday: number;
    weeklyGain: number;
    subscribersTotal: number;
  };
  ranks: {
    allTime: number | null;
    hotToday: number | null;
    hotWeek: number | null;
  };
  plugins: AuthorProfilePlugin[];
}

export interface NewestPluginRow {
  id: number;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  authorNameId: string;
  profileUrl: string;
  tags: string[];
  logoUrl: string | null;
  dateAdded: string;
  downloadsTotal: number;
  coAuthorNames: string[];
}

export interface SiteStats {
  pluginCount: number;
  authorCount: number;
  downloadsTotal: number;
  subscribersTotal: number;
  updatedAt: string | null;
}

export interface DailyPoint {
  date: string;
  downloads: number;
  avg7: number;
}

export interface CategoryStat {
  name: string;
  pluginCount: number;
  downloadsTotal: number;
  weekGain: number;
}

export interface CategoryStatsPage {
  categories: CategoryStat[];
  total: number;
  maxDownloads: number;
}

export interface GrowthSparkRow {
  id: number;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  growthPct: number;
  spark: number[];
}

export interface NewReleaseRow {
  id: number;
  nameId: string;
  name: string;
  authorId: number;
  authorName: string;
  dateAdded: string;
  downloadsTotal: number;
}

export interface StatsOverview {
  updatedAt: string | null;
  totals: {
    downloadsTotal: number;
    downloadsWeek: number;
    downloadsToday: number;
    avg7Yesterday: number;
    plugins: number;
    pluginsNew30d: number;
    authors: number;
    authorsReleased30d: number;
  };
  daily: DailyPoint[];
  fastestGrowing: GrowthSparkRow[];
  newReleases: NewReleaseRow[];
}

export type CompareType = "plugin" | "author";
export type CompareMetric = "total" | "daily" | "subs";
export type CompareRangeKey = 30 | 90 | "all";

export interface CompareItemStats {
  all: number;
  hot: number;
  week: number;
  month: number;
  subs: number;
  rank: number | null;
  hotRank: number | null;
  count: number | null;
  start: string;
}

export interface CompareItem {
  key: number;
  nameId: string;
  name: string;
  sub: string;
  series: number[];
  // Only populated for type "plugin" -- see CompareItem in packages/db/src/types.ts.
  releases?: (string | null)[];
  stats: CompareItemStats;
}

export interface CompareResult {
  type: CompareType;
  metric: CompareMetric;
  from: string;
  to: string;
  items: CompareItem[];
}

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`GET ${path} -> HTTP ${response.status}`);
  return response.json();
}

export function getTopPlugins(period: Period, game: Game = "runescape", limit = 10000) {
  return getJson<{ period: Period; plugins: PluginLeaderboardRow[] }>(`/api/leaderboard/plugins?period=${period}&limit=${limit}&game=${game}`);
}

export function getTopAuthors(period: Period, game: Game = "runescape", limit = 10000) {
  return getJson<{ period: Period; authors: AuthorLeaderboardRow[] }>(`/api/leaderboard/authors?period=${period}&limit=${limit}&game=${game}`);
}

export interface PluginInfo extends PluginMeta {
  downloadsTotal: number;
  downloadsToday: number;
  subscribersTotal: number;
  popularityRankPosition: number | null;
}

// Basic metadata + current stats, no snapshot history -- a cheaper call
// than getPluginTrend for callers that only want "what are this plugin's
// numbers right now".
export function getPluginInfo(id: string | number, game: Game = "runescape") {
  return getJson<PluginInfo>(`/api/plugins/${encodeURIComponent(id)}?game=${game}`);
}

// `id` may be a numeric id (globally unique, no game needed) or a pretty
// slug ("117hd") -- slugs are only unique per game, so `game` matters for
// those. Always sent; the API ignores it for a numeric id.
//
// `window` swaps the usual one-point-per-day series for raw, un-bucketed
// ingest snapshots -- "today" (since 00:00 UTC) or "24h" (rolling last day)
// -- used by the chart's Today/24h zoom buttons.
export function getPluginTrend(id: string | number, game: Game = "runescape", window?: "today" | "24h") {
  return getJson<{ pluginId: number; plugin: PluginMeta; trend: PluginTrendPoint[]; allTimeRank: number | null }>(
    `/api/plugins/${encodeURIComponent(id)}/trend?game=${game}${window ? `&window=${window}` : ""}`,
  );
}

// "unavailable" is the plugin-hub bot pulling a broken plugin, not a real
// content/version change -- resolveReleases (trendAnnotations.ts) filters
// these out before anything reaches the chart.
export type PluginReleaseKind = "update" | "unavailable";

export interface PluginRelease {
  id: number;
  pluginId: number;
  source: "modio" | "plugin-hub";
  kind: PluginReleaseKind;
  releasedAt: string;
  version: string | null;
  changelog: string | null;
  url: string | null;
}

export function getPluginReleases(id: string | number, game: Game = "runescape") {
  return getJson<{ releases: PluginRelease[] }>(`/api/plugins/${encodeURIComponent(id)}/releases?game=${game}`);
}

// Batch form for the Compare page -- up to 4 plugin ids at once.
export function getPluginReleasesBatch(ids: number[]) {
  return getJson<{ releases: Record<number, PluginRelease[]> }>(`/api/plugins/releases?ids=${ids.join(",")}`);
}

// Batch form for the author page's plugin-list sparklines -- every plugin
// the author has in one request, rather than a /api/plugins/{id}/trend call
// (full snapshot history) per plugin.
export function getPluginSparklines(ids: number[], game: Game = "runescape", days = 20) {
  return getJson<{ sparklines: Record<number, number[]> }>(`/api/plugins/sparklines?ids=${ids.join(",")}&game=${game}&days=${days}`);
}

export function getGameUpdates(game: Game, from: string, to: string) {
  return getJson<{ updates: GameUpdate[] }>(`/api/game-updates?game=${game}&from=${from}&to=${to}`);
}

export function getSpecialEvents(game: Game, from: string, to: string) {
  return getJson<{ events: SpecialEvent[] }>(`/api/special-events?game=${game}&from=${from}&to=${to}`);
}

export function getAuthorProfile(id: string | number, game: Game = "runescape") {
  return getJson<AuthorProfile>(`/api/authors/${encodeURIComponent(id)}?game=${game}`);
}

export function search(query: string, game: Game = "runescape", limit?: number) {
  const params = new URLSearchParams({ q: query, game });
  if (limit) params.set("limit", String(limit));
  return getJson<SearchResult>(`/api/search?${params}`);
}

export function getStatus(game?: Game) {
  return getJson<{ updatedAt: string | null }>(`/api/status${game ? `?game=${game}` : ""}`);
}

export function getFastestGrowingPlugins(limit = 5, days = 7, game: Game = "runescape") {
  return getJson<{ plugins: FastestGrowingPlugin[] }>(`/api/leaderboard/fastest-growing?limit=${limit}&days=${days}&game=${game}`);
}

export function getRandomPlugin(game: Game = "runescape") {
  return getJson<{ id: number; nameId: string }>(`/api/plugins/random?game=${game}`);
}

export function getNewestPlugins(limit = 50, game: Game = "runescape") {
  return getJson<{ plugins: NewestPluginRow[] }>(`/api/leaderboard/newest?limit=${limit}&game=${game}`);
}

export function getSiteStats(game: Game = "runescape") {
  return getJson<SiteStats>(`/api/stats?game=${game}`);
}

export function getStatsOverview(range: 30 | 90 | 365 = 90, game: Game = "runescape") {
  return getJson<StatsOverview>(`/api/stats/overview?range=${range}&game=${game}`);
}

export function getCategoryStatsPage(page: number, pageSize: number, game: Game = "runescape") {
  return getJson<CategoryStatsPage>(`/api/stats/categories?page=${page}&pageSize=${pageSize}&game=${game}`);
}

export function getCompareData(type: CompareType, keys: number[], metric: CompareMetric, range: CompareRangeKey) {
  return getJson<CompareResult>(`/api/compare?type=${type}&keys=${keys.join(",")}&metric=${metric}&range=${range}`);
}

// "Log in with Discord" session endpoints -- unlike the rest of this file,
// these carry the session cookie cross-origin (web and api are different
// domains/ports), so every call here needs credentials: "include" and the
// API side answers with an echoed (not wildcard) CORS origin to match --
// see packages/api/src/lib/discordAuth.ts.
export interface DiscordUserInfo {
  id: string;
  username: string;
  avatarUrl: string;
  // Site-wide admin-panel mod (see /api/discord/admin), not to be
  // confused with a per-guild DiscordGuildAdmin below -- this is global.
  // ProfileMenu.tsx uses it to decide whether "Admin Management" even
  // shows up in the dropdown.
  isSiteAdmin: boolean;
}

export interface ManageableGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  botInstalled: boolean;
}

// Every Discord route answers an error as `{ error: "<code>" }` -- carrying
// that code (rather than just a message string) lets callers show a
// tailored message/action (e.g. "not_signed_in" -> a Log in button) instead
// of a raw "HTTP 401".
export class DiscordApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

async function getDiscordJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = body?.error ?? "unknown";
    throw new DiscordApiError(`GET ${path} -> HTTP ${response.status} (${code})`, code, response.status);
  }
  return response.json();
}

export function discordLoginUrl(): string {
  return `${API_BASE}/api/discord/oauth/login`;
}

// The *other* OAuth2 flow -- inviting the bot itself to a server, separate
// from signing in to the dashboard. Discord's own consent screen handles
// the server picker, unless guildId is given, which pre-selects (and
// locks) that specific server instead.
export function discordInstallUrl(guildId?: string): string {
  const url = new URL(`${API_BASE}/api/discord/oauth/install`);
  if (guildId) url.searchParams.set("guild_id", guildId);
  return url.toString();
}

export function getDiscordMe() {
  return getDiscordJson<{ signedIn: boolean; user?: DiscordUserInfo }>("/api/discord/me");
}

export function getDiscordGuilds() {
  return getDiscordJson<{ guilds: ManageableGuild[] }>("/api/discord/guilds");
}

export async function discordLogout(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/discord/logout`, { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(`POST /api/discord/logout -> HTTP ${response.status}`);
}

// One server's header info (name/icon/member count/bot-added-since) plus
// its General tab settings -- nickname and avatar are read live off
// Discord's own guild member object for the bot, not stored on our side.
export interface DiscordGuildDetail {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
  botAddedAt: string;
}

export interface DiscordGuildSettings {
  nickname: string | null;
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
}

export interface DiscordGuildSettingsResponse {
  guild: DiscordGuildDetail;
  settings: DiscordGuildSettings;
}

export function getDiscordGuildSettings(guildId: string) {
  return getDiscordJson<DiscordGuildSettingsResponse>(`/api/discord/guilds/${encodeURIComponent(guildId)}`);
}

export interface DiscordGuildSettingsPatch {
  nickname?: string | null;
  avatarDataUrl?: string | null;
}

// Shared by every credentialed write to a Discord route (PATCH guild
// settings, PUT/DELETE channel topics) -- same error-code extraction as
// getDiscordJson, just for methods that send a body.
async function discordRequest<T>(path: string, method: "PATCH" | "PUT" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    const code = responseBody?.error ?? "unknown";
    throw new DiscordApiError(`${method} ${path} -> HTTP ${response.status} (${code})`, code, response.status);
  }
  return response.json();
}

export function updateDiscordGuildSettings(guildId: string, patch: DiscordGuildSettingsPatch): Promise<DiscordGuildSettingsResponse> {
  return discordRequest(`/api/discord/guilds/${encodeURIComponent(guildId)}`, "PATCH", patch);
}

export interface DiscordGuildChannel {
  id: string;
  name: string;
  categoryName: string | null;
}

export function getDiscordGuildChannels(guildId: string) {
  return getDiscordJson<{ channels: DiscordGuildChannel[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`);
}

export type DiscordTopicEntityKind = "plugin" | "author";

export interface DiscordChannelTopic {
  id: number;
  guildId: string;
  channelId: string;
  channelName: string;
  entityKind: DiscordTopicEntityKind;
  entityId: number;
  entityName: string;
  template: string;
  lastRenderedTopic: string | null;
  lastRenderedAt: string | null;
  createdAt: string;
}

export interface DiscordChannelTopicsResponse {
  topics: DiscordChannelTopic[];
  intervalHours: number;
  isSubscribed: boolean;
  maxBindings: number;
  allowedIntervals: number[];
  isAdmin: boolean;
  // Site-wide admin-panel mod/owner -- gets the per-binding Refresh
  // button on every guild regardless of that guild's own subscription,
  // unlike isAdmin (which still needs isSubscribed too).
  isSiteAdmin: boolean;
}

export function getDiscordChannelTopics(guildId: string) {
  return getDiscordJson<DiscordChannelTopicsResponse>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channel-topics`);
}

export function setDiscordChannelTopicInterval(guildId: string, hours: number) {
  return discordRequest<{ intervalHours: number }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channel-topics/settings`, "PUT", { hours });
}

export interface DiscordChannelTopicInput {
  entityKind: DiscordTopicEntityKind;
  entityId: number;
  template: string;
}

export type ChannelTopicPushErrorReason = "entity_missing" | "missing_permissions" | "discord_error";

// pushError is a soft signal, not a failure -- the save itself already
// succeeded whenever this resolves at all. null means the immediate push
// (see packages/api/src/lib/channelTopicPush.ts) went through fine.
export function saveDiscordChannelTopic(guildId: string, channelId: string, input: DiscordChannelTopicInput) {
  return discordRequest<{ topic: DiscordChannelTopic; pushError: ChannelTopicPushErrorReason | null }>(
    `/api/discord/guilds/${encodeURIComponent(guildId)}/channel-topics/${encodeURIComponent(channelId)}`,
    "PUT",
    input,
  );
}

export function deleteDiscordChannelTopic(guildId: string, channelId: string) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channel-topics/${encodeURIComponent(channelId)}`, "DELETE");
}

// Admin-only: pushes one binding's current render to Discord right away
// instead of waiting for the next hourly tick.
export function refreshDiscordChannelTopic(guildId: string, channelId: string) {
  return discordRequest<{ topic: DiscordChannelTopic }>(
    `/api/discord/guilds/${encodeURIComponent(guildId)}/channel-topics/${encodeURIComponent(channelId)}/refresh`,
    "POST",
  );
}

export interface DiscordGuildAdmin {
  id: number;
  guildId: string;
  discordUserId: string;
  addedBy: string;
  createdAt: string;
}

export interface DiscordGuildSubscription {
  guildId: string;
  grantedBy: string;
  createdAt: string;
}

export interface DiscordResolvedUser {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface DiscordGuildAdminsResponse {
  admins: DiscordGuildAdmin[];
  isOwner: boolean;
  subscribed: boolean;
  subscription: DiscordGuildSubscription | null;
  users: Record<string, DiscordResolvedUser | null>;
}

// 403s for anyone who isn't an admin/owner of this guild -- the Advanced
// Settings tab in DiscordServer.tsx uses that itself as the "is this
// person even an admin" signal, rather than needing a separate check
// endpoint. subscribed/subscription are read-only here -- granting or
// revoking a guild's subscription is only ever done from the site-wide
// admin panel (getDiscordAdminPanel below), not from this guild's own
// Advanced Settings tab.
export function getDiscordGuildAdmins(guildId: string) {
  return getDiscordJson<DiscordGuildAdminsResponse>(`/api/discord/guilds/${encodeURIComponent(guildId)}/admins`);
}

export function addDiscordGuildAdmin(guildId: string, discordUserId: string) {
  return discordRequest<{ admin: DiscordGuildAdmin }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/admins/${encodeURIComponent(discordUserId)}`, "PUT");
}

export function removeDiscordGuildAdmin(guildId: string, discordUserId: string) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/admins/${encodeURIComponent(discordUserId)}`, "DELETE");
}

// Per-server command toggles (docs/discord-bot.md's "Per-server command
// toggles"). "disabled" lists just the commands turned off for this
// guild -- anything not in that list is on by default (same "missing =
// on" convention as the DB table behind it).
export function getDiscordGuildCommands(guildId: string) {
  return getDiscordJson<{ disabled: string[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/commands`);
}

export function setDiscordCommandEnabled(guildId: string, commandName: string, enabled: boolean) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/commands/${encodeURIComponent(commandName)}`, enabled ? "PUT" : "DELETE");
}

// Read-only: the bot's /link, /unlink, and /mystats slash commands are
// the only write path for this data (see packages/db/src/authorLinks.ts's
// own comment) -- there's deliberately no PUT/DELETE here, a guild admin
// can see links but only the member themselves can change one.
export interface DiscordLinkedAuthor {
  discordUserId: string;
  username: string;
  avatarUrl: string;
  runescape: string | null;
  runelite: string | null;
  linkedAt: string;
}

export function getDiscordGuildLinkedAuthors(guildId: string) {
  return getDiscordJson<{ links: DiscordLinkedAuthor[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/linked-authors`);
}


// -- Site-wide admin panel (global, not scoped to any one guild -- see
// /api/discord/admin). A different, higher tier than the per-guild
// DiscordGuildAdmin stuff above.

export interface SiteAdmin {
  id: number;
  discordUserId: string;
  addedBy: string;
  createdAt: string;
}

export interface DiscordAdminPanelGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  subscribed: boolean;
  subscription: DiscordGuildSubscription | null;
  bindingCount: number;
}

export interface DiscordAdminPanelResponse {
  mods: SiteAdmin[];
  guilds: DiscordAdminPanelGuild[];
  users: Record<string, DiscordResolvedUser | null>;
}

// 403s for anyone who isn't a site-wide mod -- DiscordAdminPage.tsx has
// no separate "am I allowed to see this" check beyond this call failing.
export function getDiscordAdminPanel() {
  return getDiscordJson<DiscordAdminPanelResponse>("/api/discord/admin");
}

export function addDiscordSiteMod(discordUserId: string) {
  return discordRequest<{ mod: SiteAdmin }>(`/api/discord/admin/mods/${encodeURIComponent(discordUserId)}`, "PUT");
}

export function removeDiscordSiteMod(discordUserId: string) {
  return discordRequest<{ ok: true }>(`/api/discord/admin/mods/${encodeURIComponent(discordUserId)}`, "DELETE");
}

export function grantDiscordGuildSubscriptionGlobal(guildId: string) {
  return discordRequest<{ subscribed: true }>(`/api/discord/admin/guilds/${encodeURIComponent(guildId)}/subscription`, "PUT");
}

export function revokeDiscordGuildSubscriptionGlobal(guildId: string) {
  return discordRequest<{ subscribed: false }>(`/api/discord/admin/guilds/${encodeURIComponent(guildId)}/subscription`, "DELETE");
}

// -- Announcements (docs/discord-bot.md's "Notifications") --

export interface DiscordGuildRole {
  id: string;
  name: string;
  color: number;
  mentionable: boolean;
}

export function getDiscordGuildRoles(guildId: string) {
  return getDiscordJson<{ roles: DiscordGuildRole[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/roles`);
}

export type DiscordAnnouncementKind = "release" | "update";

// Ping is three independent signals, not one mutually-exclusive mode --
// see packages/db/src/schema.sql's comment on discord_announcement_watches.
// pingHere and pingEveryone are mutually exclusive with *each other*, but
// either can combine with any set of pingRoleIds.
export interface DiscordPing {
  pingHere: boolean;
  pingEveryone: boolean;
  pingRoleIds: string[];
  pingRoleNames: string[];
}

// Same three ping signals, minus pingRoleNames -- that's always
// server-resolved from pingRoleIds (see resolveChannelAndPing in
// packages/api/src/lib/announcements.ts), never something the client
// supplies itself.
export interface DiscordPingInput {
  pingHere: boolean;
  pingEveryone: boolean;
  pingRoleIds: string[];
}

// The Global tab's rows -- a flexible list, not fixed slots. See
// packages/db/src/schema.sql's discord_announcement_watches comment.
export interface DiscordAnnouncementWatch extends DiscordPing {
  id: number;
  guildId: string;
  channelId: string;
  channelName: string;
  kind: DiscordAnnouncementKind;
  games: string[];
  showThumbnail: boolean;
  lastAnnouncedAt: string;
  createdAt: string;
}

export interface DiscordAnnouncementWatchInput extends DiscordPingInput {
  channelId: string;
  kind: DiscordAnnouncementKind;
  games: string[];
  showThumbnail: boolean;
}

export function getDiscordAnnouncementWatches(guildId: string) {
  return getDiscordJson<{ watches: DiscordAnnouncementWatch[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/watches`);
}

export function createDiscordAnnouncementWatch(guildId: string, input: DiscordAnnouncementWatchInput) {
  return discordRequest<{ watch: DiscordAnnouncementWatch }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/watches`, "POST", input);
}

export function updateDiscordAnnouncementWatch(guildId: string, id: number, input: DiscordAnnouncementWatchInput) {
  return discordRequest<{ watch: DiscordAnnouncementWatch }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/watches/${id}`, "PUT", input);
}

export function deleteDiscordAnnouncementWatch(guildId: string, id: number) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/watches/${id}`, "DELETE");
}

// Open to any user with normal dashboard access -- posts a one-off test
// message using sample data to this watch's configured channel, so
// someone can check the channel actually works and see what the embed
// looks like, without waiting for a real release/update.
export function testDiscordAnnouncementWatch(guildId: string, id: number) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/watches/${id}/test`, "POST");
}

export type DiscordEntityAnnouncementKind = "release" | "update" | "both";

// The Per-plugin/author tab's rows -- additive to any Global watch rule
// that also happens to match the same plugin, not a replacement for it.
// entityKind 'author' means "any plugin published/updated by this
// author", not a literal author-profile event.
export interface DiscordEntityAnnouncement extends DiscordPing {
  id: number;
  guildId: string;
  channelId: string;
  channelName: string;
  entityKind: DiscordTopicEntityKind;
  entityId: number;
  entityName: string;
  kind: DiscordEntityAnnouncementKind;
  showThumbnail: boolean;
  lastAnnouncedAt: string;
  createdAt: string;
}

export interface DiscordEntityAnnouncementInput extends DiscordPingInput {
  channelId: string;
  entityKind: DiscordTopicEntityKind;
  entityId: number;
  kind: DiscordEntityAnnouncementKind;
  showThumbnail: boolean;
}

export function getDiscordEntityAnnouncements(guildId: string) {
  return getDiscordJson<{ bindings: DiscordEntityAnnouncement[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/entities`);
}

// Upserts on (channelId, entityKind, entityId) -- re-saving the same
// pairing updates its settings in place, same as saveDiscordChannelTopic.
export function saveDiscordEntityAnnouncement(guildId: string, input: DiscordEntityAnnouncementInput) {
  return discordRequest<{ binding: DiscordEntityAnnouncement }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/entities`, "POST", input);
}

export function deleteDiscordEntityAnnouncement(guildId: string, id: number) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/entities/${id}`, "DELETE");
}

// Same as testDiscordAnnouncementWatch, for a Per-plugin/author binding.
export function testDiscordEntityAnnouncement(guildId: string, id: number) {
  return discordRequest<{ ok: true }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/entities/${id}/test`, "POST");
}

// The Embed builder tab's per-guild config -- subscriber-gated to save
// (PUT), but freely readable (GET) so free-tier guilds still see what
// their announcements currently look like (the defaults).
export interface DiscordGuildAnnouncementEmbed {
  guildId: string;
  color: string;
  titleTemplate: string;
  descriptionTemplate: string;
  footerTemplate: string;
  showThumbnail: boolean;
  updatedAt: string;
}

export function getDiscordAnnouncementEmbed(guildId: string) {
  return getDiscordJson<{ embed: DiscordGuildAnnouncementEmbed; isSubscribed: boolean }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/embed`);
}

export interface DiscordAnnouncementEmbedPatch {
  color: string;
  titleTemplate: string;
  descriptionTemplate: string;
  footerTemplate: string;
  showThumbnail: boolean;
}

export function setDiscordAnnouncementEmbed(guildId: string, patch: DiscordAnnouncementEmbedPatch) {
  return discordRequest<{ embed: DiscordGuildAnnouncementEmbed }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/announcements/embed`, "PUT", patch);
}
