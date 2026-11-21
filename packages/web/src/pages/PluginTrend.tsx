import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  API_BASE,
  getGameUpdates,
  getPluginReleases,
  getPluginTrend,
  getSpecialEvents,
  getTopPlugins,
  type GameUpdate,
  type PluginLeaderboardRow,
  type PluginMeta,
  type PluginRelease,
  type PluginTrendPoint,
  type SpecialEvent,
} from "../api";
import { TrendChart, trendMetrics, type TrendMetric } from "../components/TrendChart";
import { useGame } from "../context/GameContext";
import { AvatarImg } from "../components/AvatarImg";
import { slugifyTag } from "../lib/slug";
import { authorHref, pluginHref } from "../lib/links";
import { usePageMeta } from "../hooks/usePageMeta";

const METRIC_KEYS: TrendMetric[] = ["downloadsTotal", "downloadsToday", "subscribersTotal"];

function parseMetric(v: string | null): TrendMetric {
  return (METRIC_KEYS as string[]).includes(v ?? "") ? (v as TrendMetric) : "downloadsTotal";
}

export function PluginTrend() {
  const { id } = useParams<{ id: string }>();
  const { game, setGame } = useGame();
  const [searchParams, setSearchParams] = useSearchParams();
  const [plugin, setPlugin] = useState<PluginMeta | null>(null);
  const [points, setPoints] = useState<PluginTrendPoint[] | null>(null);
  const [gameUpdates, setGameUpdates] = useState<GameUpdate[]>([]);
  const [specialEvents, setSpecialEvents] = useState<SpecialEvent[]>([]);
  const [releases, setReleases] = useState<PluginRelease[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Metric is the one piece of chart state this page still owns directly
  // (the tiles live outside the chart card) -- everything else (range,
  // zoom, chart type, annotation layers, sensitivity) is read once from
  // and reported back to this same URL by TrendChart itself.
  //
  // Both setMetric and handleChartParamsChange use setSearchParams's
  // functional-updater form (prev => next), not a `new URLSearchParams
  // (searchParams)` closing over the `searchParams` already in scope --
  // TrendChart's own URL-sync effect doesn't (and shouldn't) list this
  // callback in its dependency array, so a stale closure here would
  // otherwise silently roll back whichever param changed more recently
  // between a metric-tile click and a chart interaction.
  const metric = parseMetric(searchParams.get("metric"));
  function setMetric(m: TrendMetric) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (m !== "downloadsTotal") next.set("metric", m);
        else next.delete("metric");
        return next;
      },
      { replace: true },
    );
  }
  function handleChartParamsChange(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  const [hotRank, setHotRank] = useState<number | null>(null);
  const [hotPlugins, setHotPlugins] = useState<PluginLeaderboardRow[] | null>(null);
  const [allTimeRank, setAllTimeRank] = useState<number | null>(null);
  const [allPlugins, setAllPlugins] = useState<PluginLeaderboardRow[] | null>(null);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [hoveredAuthorIndex, setHoveredAuthorIndex] = useState<number | null>(null);

  // Raw, un-bucketed snapshots backing the "Change today" tile's noon-to-noon
  // UTC comparison below -- the daily `points` series is forward-filled to
  // one dot per day, too coarse to find "the snapshot closest to noon". Only
  // RuneLite shows that tile (see todayChange further down), so only
  // RuneLite fetches this.
  const [rawPoints, setRawPoints] = useState<PluginTrendPoint[] | null>(null);

  useEffect(() => {
    if (!id) return;
    getPluginTrend(id, game)
      .then((res) => {
        setPlugin(res.plugin);
        setPoints(res.trend);
        setGame(res.plugin.game);
        setAllTimeRank(res.allTimeRank);

        getPluginReleases(res.pluginId, res.plugin.game)
          .then((releasesRes) => setReleases(releasesRes.releases))
          .catch(() => setReleases([]));

        // Only RuneLite's live install gauge shows the "Change today" tile
        // (see todayChange below) -- mod.io plugins don't need this fetch.
        if (res.plugin.game === "runelite") {
          getPluginTrend(res.pluginId, res.plugin.game, "48h")
            .then((rawRes) => setRawPoints(rawRes.trend))
            .catch(() => setRawPoints([]));
        }

        if (res.trend.length > 0) {
          const from = res.trend[0].capturedAt.slice(0, 10);
          const to = res.trend[res.trend.length - 1].capturedAt.slice(0, 10);
          getGameUpdates(res.plugin.game, from, to)
            .then((updatesRes) => setGameUpdates(updatesRes.updates))
            .catch(() => setGameUpdates([]));
          getSpecialEvents(res.plugin.game, from, to)
            .then((eventsRes) => setSpecialEvents(eventsRes.events))
            .catch(() => setSpecialEvents([]));
        }

        getTopPlugins("hot", res.plugin.game, 15)
          .then((hotRes) => {
            const rank = hotRes.plugins.findIndex((p) => p.id === res.pluginId);
            setHotRank(rank !== -1 && rank < 10 ? rank + 1 : null);
            setHotPlugins(hotRes.plugins);
          })
          .catch(() => {});

        // Only for similarPlugins' tag matching below (allTimeRank comes
        // straight from the trend response now) -- capped at 500 so this
        // shares a cache entry with the other pages that already fetch the
        // alltime leaderboard at that same limit, instead of being the one
        // place on the site asking for the whole catalog.
        getTopPlugins("alltime", res.plugin.game, 500)
          .then((allRes) => setAllPlugins(allRes.plugins))
          .catch(() => setAllPlugins([]));
      })
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setGame]);

  const latestPoint = points && points.length > 0 ? points[points.length - 1] : null;
  usePageMeta({
    title: plugin ? `${plugin.name} by ${plugin.authorName} — RuneScape PluginPulse` : "RuneScape PluginPulse",
    description: plugin
      ? `${plugin.summary || "Download trends and stats"}${
          latestPoint ? ` — ${latestPoint.downloadsTotal.toLocaleString()} ${plugin.game === "runelite" ? "installs" : "downloads"}.` : "."
        }`
      : "Plugin download trends and stats on RuneScape PluginPulse.",
    canonicalPath: plugin ? (plugin.game === "runescape" ? `/plugin/${plugin.nameId}` : `/plugin/${plugin.nameId}?game=${plugin.game}`) : `/plugin/${id ?? ""}`,
    image: plugin ? `${API_BASE}/api/card/plugin/${plugin.id}.png` : undefined,
    jsonLd:
      plugin && latestPoint
        ? {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: plugin.name,
            author: { "@type": "Person", name: plugin.authorName },
            applicationCategory: "GameApplication",
            operatingSystem: plugin.game === "runelite" ? "RuneLite" : "RuneScape",
            description: plugin.summary || undefined,
            url: `https://rspluginpulse.com${pluginHref(plugin.nameId, plugin.game as "runescape" | "osrs" | "runelite")}`,
            interactionStatistic: {
              "@type": "InteractionCounter",
              interactionType: "https://schema.org/InstallAction",
              userInteractionCount: latestPoint.downloadsTotal,
            },
          }
        : undefined,
  });

  const similarPlugins = useMemo(() => {
    if (!allPlugins || !plugin) return [];
    return allPlugins
      .filter((p) => p.id !== plugin.id)
      .map((p) => ({ plugin: p, shared: p.tags.filter((t) => plugin.tags.includes(t)).length }))
      .filter((p) => p.shared > 0)
      .sort((a, b) => b.shared - a.shared || b.plugin.value - a.plugin.value)
      .slice(0, 4);
  }, [allPlugins, plugin]);

  if (error) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          ← Back to leaderboard
        </Link>
        <p>Failed to load: {error}</p>
      </div>
    );
  }

  if (!plugin || !points) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          ← Back to leaderboard
        </Link>

        <div className="card plugin-profile-card">
          <div className="card-edge" />
          <div className="plugin-profile-head">
            <div className="plugin-logo-col">
              <div className="plugin-logo-frame">
                <div className="skeleton-bar" style={{ width: "100%", height: "100%", borderRadius: 7 }} />
              </div>
            </div>
            <div className="author-profile-info">
              <div className="author-profile-title">
                <span className="skeleton-bar" style={{ width: 220, height: 22 }} />
              </div>
              <span className="skeleton-bar" style={{ width: "90%", height: 14 }} />
              <div className="author-badges">
                <span className="skeleton-bar" style={{ width: 80, height: 20, borderRadius: 999 }} />
                <span className="skeleton-bar" style={{ width: 100, height: 20, borderRadius: 999 }} />
              </div>
            </div>
          </div>
        </div>

        <div className="metric-tiles">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="metric-tile" key={i}>
              <span className="skeleton-bar" style={{ width: "50%", height: 11 }} />
              <span className="skeleton-bar" style={{ width: "40%", height: 26 }} />
              <span className="skeleton-bar" style={{ width: "60%", height: 12 }} />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-edge" />
          <div className="chart-card-head">
            <span className="skeleton-bar" style={{ width: 140, height: 15 }} />
            <span className="skeleton-bar" style={{ width: 220, height: 30, borderRadius: 8 }} />
          </div>
          <div style={{ padding: "8px clamp(8px, 3vw, 20px) 14px" }}>
            <span className="skeleton-bar" style={{ width: "100%", height: 280, borderRadius: 8 }} />
          </div>
        </div>
      </div>
    );
  }

  const metrics = trendMetrics(plugin.game);
  // Falls back to the first entry for a stale/bookmarked ?metric= value
  // that trendMetrics no longer offers for this game (e.g. "downloadsToday"
  // on a RuneLite plugin, which has no such metric).
  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];
  const last = points[points.length - 1];
  const tiles = metrics.map((m) => ({ ...m, ...tileValueAndSub(points, m.key) }));
  // RuneLite has no real daily figure (downloadsToday is always 0, see
  // runelite.ts) -- a real "today" number for that plugin's live install
  // gauge is the noon-to-noon UTC change instead (see dailyChange below).
  // Display-only, not a selectable chart metric (there's no "change" series
  // to plot).
  const todayChange = plugin.game === "runelite" ? dailyChange(rawPoints ?? []) : null;
  // Same idea as todayChange, just over 30 days -- a monthly figure that
  // actually means something for a live gauge, unlike subscribersTotal
  // (which used to sit here as a redundant duplicate of Total installs).
  const monthlyChange = plugin.game === "runelite" ? smoothedGain(points, 30) : null;
  const compareIds = [plugin.id, ...(hotPlugins ?? []).filter((p) => p.id !== plugin.id).slice(0, 2).map((p) => p.id)];
  const compact = plugin.game === "runelite";
  const authorEntries = plugin.coAuthors;
  const MAX_STACKED_AVATARS = 4;
  const actionButtons = (
    <div className={`plugin-profile-actions ${compact ? "horizontal" : ""}`}>
      <Link className="plugin-action-btn" to={`/compare?tab=compare&type=plugin&pids=${compareIds.join(",")}`}>
        Compare
      </Link>
      <Link className="plugin-action-btn" to={`/api?tab=badge&type=plugin&id=${plugin.id}`}>
        View badge
      </Link>
      <Link className="plugin-action-btn" to={`/api?tab=embed&type=plugin&id=${plugin.id}`}>
        View card
      </Link>
      {similarPlugins.length > 0 && (
        <button className="plugin-action-btn" onClick={() => setShowSimilarModal(true)}>
          Similar plugins →
        </button>
      )}
    </div>
  );

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Back to leaderboard
      </Link>

      <div className="card plugin-profile-card">
        <div className="card-edge" />
        <div className="plugin-profile-head">
          <div className={`plugin-logo-col ${compact ? "compact" : ""}`}>
            <div className={`plugin-logo-frame ${compact ? "compact" : ""}`}>
              {plugin.logoUrl ? (
                <img src={plugin.logoUrl} alt="" className="plugin-logo-img" />
              ) : (
                <div className="plugin-logo-fallback brand-font">{initials(plugin.name)}</div>
              )}
            </div>
            <div className="plugin-logo-meta">
              {authorEntries.length > 1 ? (
                <div className="plugin-author-chip">
                  <span className="plugin-author-avatar-stack">
                    {authorEntries.slice(0, MAX_STACKED_AVATARS).map((entry, i) => (
                      <span
                        key={i}
                        className={`plugin-author-avatar stacked ${hoveredAuthorIndex === i ? "highlighted" : ""} ${hoveredAuthorIndex !== null && hoveredAuthorIndex !== i ? "dimmed" : ""}`}
                      >
                        <AvatarImg
                          src={entry.avatarUrl}
                          fallbackText={initials(entry.name)}
                          imgClassName="plugin-author-avatar-img"
                          fallbackClassName="plugin-author-avatar-fallback brand-font"
                        />
                      </span>
                    ))}
                    {authorEntries.length > MAX_STACKED_AVATARS && (
                      <span className="plugin-author-avatar stacked plugin-author-avatar-overflow">
                        +{authorEntries.length - MAX_STACKED_AVATARS}
                      </span>
                    )}
                  </span>
                  <span className="plugin-author-name">
                    {authorEntries.map((entry, i) => (
                      <span
                        key={i}
                        onMouseEnter={() => setHoveredAuthorIndex(i)}
                        onMouseLeave={() => setHoveredAuthorIndex(null)}
                      >
                        {i > 0 && ", "}
                        <Link to={authorHref(entry.nameId, game)} className="plugin-author-name-link">
                          {entry.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                </div>
              ) : (
                <Link to={authorHref(plugin.authorNameId, game)} className="plugin-author-chip">
                  <span className="plugin-author-avatar">
                    {plugin.authorAvatarUrl ? (
                      <img src={plugin.authorAvatarUrl} alt="" className="plugin-author-avatar-img" />
                    ) : (
                      <span className="plugin-author-avatar-fallback brand-font">{initials(plugin.authorName)}</span>
                    )}
                  </span>
                  <span className="plugin-author-name">{plugin.authorName}</span>
                </Link>
              )}
              <div className="plugin-logo-meta-dates">
                <div className="plugin-logo-meta-row">
                  <span className="plugin-logo-meta-label">Added</span>
                  <span className="plugin-logo-meta-value">{formatDate(plugin.dateAdded)}</span>
                </div>
                <div className="plugin-logo-meta-row">
                  <span className="plugin-logo-meta-label">Updated</span>
                  <span className="plugin-logo-meta-value">{formatDate(plugin.dateUpdated)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="author-profile-info">
            <div className="author-profile-title">
              <h1 className="brand-font">{plugin.name}</h1>
              {allTimeRank !== null && <span className="rank-badge">#{allTimeRank} all-time</span>}
              {hotRank !== null && <span className="hot-now-badge">#{hotRank} HOT NOW</span>}
              <a href={plugin.profileUrl} target="_blank" rel="noopener" className="author-mod-link">
                {plugin.game === "runelite" ? "View on plugin hub ↗" : "View on mod.io ↗"}
              </a>
            </div>
            {plugin.summary && <p className="plugin-summary">{plugin.summary}</p>}
            {plugin.tags.length > 0 && (
              <div className="author-badges">
                {plugin.tags.map((tag) => (
                  <Link key={tag} to={`/tags/${slugifyTag(tag)}`} className="author-badge author-badge-link">
                    {tag}
                  </Link>
                ))}
              </div>
            )}
            {compact && actionButtons}
            {plugin.game !== "runelite" &&
              (plugin.ratingsTotal > 0 ? (
                <div className="plugin-rating">
                  <div className="plugin-rating-top">
                    <span className={`plugin-rating-label ${plugin.ratingsPercentagePositive < 40 ? "negative" : ""}`}>
                      {plugin.ratingsDisplayText}
                    </span>
                    <span className="plugin-rating-pct">{plugin.ratingsPercentagePositive}%</span>
                  </div>
                  <div className="plugin-rating-track">
                    <div
                      className={`plugin-rating-fill ${plugin.ratingsPercentagePositive < 40 ? "negative" : ""}`}
                      style={{ width: `${plugin.ratingsPercentagePositive}%` }}
                    />
                  </div>
                  <div className="plugin-rating-counts">
                    <span className="plugin-rating-count">
                      <ThumbUpIcon />
                      {plugin.ratingsPositive.toLocaleString()}
                    </span>
                    <span className="plugin-rating-count">
                      <ThumbDownIcon />
                      {plugin.ratingsNegative.toLocaleString()}
                    </span>
                    <span className="plugin-rating-total">{plugin.ratingsTotal.toLocaleString()} ratings</span>
                  </div>
                </div>
              ) : (
                <span className="plugin-rating-empty">No ratings yet</span>
              ))}
          </div>
          {!compact && actionButtons}
        </div>
      </div>

      <div className="metric-tiles" role={metrics.length > 1 ? "radiogroup" : undefined} aria-label={metrics.length > 1 ? "Metric" : undefined}>
        {/* RuneLite only ever has one real chartable series (its live
            install gauge, see trendMetrics) -- with nothing to actually
            choose between, these render as plain stat cards instead of
            the mod.io-style selectable "pick what's charted" tiles. */}
        {metrics.length > 1
          ? tiles.map((t) => (
              <button key={t.key} className={`metric-tile ${activeMetric.key === t.key ? "active" : ""}`} onClick={() => setMetric(t.key)}>
                <span className="metric-tile-top">
                  <span className="metric-tile-label">{t.label}</span>
                  {activeMetric.key === t.key ? (
                    <span className="metric-tile-charted">
                      <span className="metric-tile-charted-swatch" />
                      Charted
                    </span>
                  ) : (
                    <span className="metric-tile-hint">Show on chart →</span>
                  )}
                </span>
                <span className="metric-tile-value">{last[t.key].toLocaleString()}</span>
                <span className="metric-tile-sub">{t.sub}</span>
              </button>
            ))
          : tiles.map((t) => (
              <div key={t.key} className="metric-tile">
                <span className="metric-tile-top">
                  <span className="metric-tile-label">{t.label}</span>
                </span>
                <span className="metric-tile-value">{last[t.key].toLocaleString()}</span>
                <span className="metric-tile-sub">{t.sub}</span>
              </div>
            ))}
        {plugin.game === "runelite" && (
          <div className="metric-tile">
            <span className="metric-tile-top">
              <span className="metric-tile-label">Change today</span>
            </span>
            {todayChange !== null ? (
              <>
                <span className="metric-tile-value">
                  {todayChange >= 0 ? "+" : ""}
                  {todayChange.toLocaleString()}
                </span>
                <span className="metric-tile-sub">noon vs. noon yesterday (UTC)</span>
              </>
            ) : (
              <>
                <span className="metric-tile-value">—</span>
                <span className="metric-tile-sub">Not enough history yet</span>
              </>
            )}
          </div>
        )}
        {monthlyChange !== null && (
          <div className="metric-tile">
            <span className="metric-tile-top">
              <span className="metric-tile-label">Installs monthly</span>
            </span>
            <span className="metric-tile-value">
              {monthlyChange >= 0 ? "+" : ""}
              {monthlyChange.toLocaleString()}
            </span>
            <span className="metric-tile-sub">last 30 days</span>
          </div>
        )}
      </div>

      <TrendChart
        points={points}
        pluginId={plugin.id}
        game={plugin.game}
        metric={activeMetric.key}
        scoreMetric={plugin.game === "runelite" ? "downloadsTotal" : "downloadsToday"}
        metricLabel={activeMetric.label}
        unit={activeMetric.unit}
        pluginName={plugin.name}
        initialParams={searchParams}
        onParamsChange={handleChartParamsChange}
        gameUpdates={gameUpdates}
        specialEvents={specialEvents}
        releases={releases}
      />

      {showSimilarModal && (
        <div className="legal-overlay" onClick={() => setShowSimilarModal(false)}>
          <div role="dialog" aria-modal="true" className="legal-dialog confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="card-edge" />
            <div className="legal-dialog-header">
              <h2>Similar plugins</h2>
              <button className="legal-close" aria-label="Close" onClick={() => setShowSimilarModal(false)}>
                ×
              </button>
            </div>
            <div className="legal-body similar-plugins-modal-body">
              {similarPlugins.map(({ plugin: p, shared }) => (
                <Link key={p.id} to={pluginHref(p.nameId, game)} className="similar-plugin-row" onClick={() => setShowSimilarModal(false)}>
                  <span className="similar-plugin-name">{p.name}</span>
                  <span className="similar-plugin-sub">
                    by {p.authorName} · {shared} shared tag{shared === 1 ? "" : "s"}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ThumbUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M6 7V14H3.5C2.95 14 2.5 13.55 2.5 13V8C2.5 7.45 2.95 7 3.5 7H6ZM6 7L9 2.5C9.8 2.5 10.5 3.2 10.5 4V6H12.5C13.3 6 13.9 6.75 13.7 7.55L12.6 12.55C12.45 13.35 11.75 14 10.9 14H6" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M6 9V2H3.5C2.95 2 2.5 2.45 2.5 3V8C2.5 8.55 2.95 9 3.5 9H6ZM6 9L9 13.5C9.8 13.5 10.5 12.8 10.5 12V10H12.5C13.3 10 13.9 9.25 13.7 8.45L12.6 3.45C12.45 2.65 11.75 2 10.9 2H6" />
    </svg>
  );
}

function tileValueAndSub(points: PluginTrendPoint[], metric: TrendMetric): { sub: string } {
  const last = points[points.length - 1];

  if (metric === "downloadsTotal") {
    const gain = smoothedGain(points, 7);
    return { sub: `${gain >= 0 ? "+" : ""}${gain.toLocaleString()} this week` };
  }
  if (metric === "downloadsToday") {
    const yesterday = findPointNear(points, 1).downloadsToday;
    return { sub: `${yesterday.toLocaleString()} yesterday` };
  }
  const gain = last.subscribersTotal - findPointNear(points, 30).subscribersTotal;
  return { sub: `${gain >= 0 ? "+" : ""}${gain.toLocaleString()} last 30 days` };
}

function findPointNear(points: PluginTrendPoint[], daysAgo: number): PluginTrendPoint {
  const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  let candidate: PluginTrendPoint | null = null;
  for (const p of points) {
    if (new Date(p.capturedAt).getTime() <= cutoff) candidate = p;
  }
  return candidate ?? points[0];
}

// RuneLite's downloadsTotal is a live "currently reporting installs" gauge,
// not a cumulative counter (see runelite.ts), so a single day's reading
// drifts up and down with no real trend. Diffing findPointNear's single
// point against `last` picks up that noise as if it were growth/decline --
// for small plugins that noise dominates, showing a meaningless +/-1. See
// gainWindowDays in @rspluginpulse/db's queries.ts for the same fix applied
// to the leaderboard figures; this mirrors it using the daily points this
// page already has loaded, instead of re-querying the server.
function gainWindowDays(cutoffDays: number): number {
  return Math.min(cutoffDays / 4, 3);
}

function averageNear(points: PluginTrendPoint[], daysAgo: number, windowDays: number): number {
  const center = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const lo = center - windowDays * 24 * 60 * 60 * 1000;
  const hi = center + windowDays * 24 * 60 * 60 * 1000;
  const inWindow = points.filter((p) => {
    const t = new Date(p.capturedAt).getTime();
    return t >= lo && t <= hi;
  });
  if (inWindow.length === 0) return findPointNear(points, daysAgo).downloadsTotal;
  return inWindow.reduce((sum, p) => sum + p.downloadsTotal, 0) / inWindow.length;
}

function averageTrailing(points: PluginTrendPoint[], windowDays: number): number {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = points.filter((p) => new Date(p.capturedAt).getTime() >= cutoff);
  if (inWindow.length === 0) return points[points.length - 1]?.downloadsTotal ?? 0;
  return inWindow.reduce((sum, p) => sum + p.downloadsTotal, 0) / inWindow.length;
}

function smoothedGain(points: PluginTrendPoint[], cutoffDays: number): number {
  const windowDays = gainWindowDays(cutoffDays);
  return Math.round(averageTrailing(points, windowDays) - averageNear(points, cutoffDays, windowDays));
}

// Last raw snapshot at or before `targetMs`, scanning the (chronologically
// ordered) raw/un-bucketed snapshots -- the daily-bucket equivalent of
// findPointNear above, just not limited to one point per calendar day.
function snapshotAtOrBefore(raw: PluginTrendPoint[], targetMs: number): PluginTrendPoint | null {
  let candidate: PluginTrendPoint | null = null;
  for (const p of raw) {
    if (new Date(p.capturedAt).getTime() <= targetMs) candidate = p;
  }
  return candidate;
}

// The most recently completed UTC noon at or before `beforeMs`.
function priorNoonUtc(beforeMs: number): number {
  const d = new Date(beforeMs);
  const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0);
  return noon <= beforeMs ? noon : noon - 24 * 60 * 60 * 1000;
}

// Noon-to-noon UTC change on the raw install gauge -- both endpoints sit at
// the same time of day, a day apart, so a plugin-hub ingest delay (which can
// leave "right now" lagging behind the real current count) shifts both sides
// of the diff by roughly the same amount instead of comparing a half-updated
// "now" against a fully-settled "yesterday". Needs raw snapshots covering up
// to ~48h back (see the "48h" window in api.ts/route.ts) -- worst case is
// "now" sitting a minute before today's noon, making yesterday's noon the
// most recent completed one and the day before that the one before it.
function dailyChange(raw: PluginTrendPoint[]): number | null {
  if (raw.length === 0) return null;
  const noon1 = priorNoonUtc(Date.now());
  const noon0 = noon1 - 24 * 60 * 60 * 1000;
  const p1 = snapshotAtOrBefore(raw, noon1);
  const p0 = snapshotAtOrBefore(raw, noon0);
  if (!p1 || !p0) return null;
  return Math.round(p1.downloadsTotal - p0.downloadsTotal);
}

