import { getExistingNameIds, getOrCreateExternalIds, type CoAuthorIngest, type IngestedMod } from "@rspluginpulse/db";

// RuneLite exposes no API key / auth, and no cumulative download counter --
// `pluginhub` is a live gauge of currently-reporting installs, not a total.
// We treat that gauge as both downloadsTotal and subscribersTotal (the
// closest existing fields), and downloadsToday as 0 (no daily figure
// exists upstream); the diff-based weekly/monthly "gain" queries elsewhere
// in this codebase still work fine against that gauge over time.
const BOOTSTRAP_URL = "https://static.runelite.net/bootstrap.json";
const ICON_BASE = "https://repo.runelite.net/plugins/icon";
const PLUGIN_HUB_BASE = "https://runelite.net/plugin-hub/show";
const REPO_RAW_BASE = "https://raw.githubusercontent.com/runelite/plugin-hub/master/plugins";
const REPO_CONCURRENCY = 12;

// RuneLite's own infra (static./repo./api.runelite.net) has occasional
// transient blips (a 504 from api.runelite.net/.../pluginhub is what
// prompted this) -- retried with backoff rather than letting one bad
// moment fail the whole hourly ingest run outright. Only retries 5xx/429/
// network errors; a 4xx (404, etc.) is a real, non-transient problem that
// retrying won't fix, so that still fails immediately.
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url);
    } catch (error) {
      lastError = error;
    }
    if (res) {
      if (res.ok) return res;
      // A 4xx (other than 429) is a real problem -- wrong URL, auth,
      // whatever -- that retrying won't fix, so fail immediately instead
      // of burning through attempts on something that'll never succeed.
      if (res.status < 500 && res.status !== 429) throw new Error(`GET ${url} -> HTTP ${res.status}`);
      lastError = new Error(`GET ${url} -> HTTP ${res.status}`);
    }
    if (attempt < attempts) {
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(`  ${url} failed (attempt ${attempt}/${attempts}), retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

interface ManifestDisplayEntry {
  internalName: string;
  displayName: string;
  version: string;
  iconHash?: string;
  createdAt: number;
  lastUpdatedAt: number;
  author: string;
  description: string;
  tags?: string[];
}

interface Manifest {
  display: ManifestDisplayEntry[];
  jars: { internalName: string }[];
}

async function getClientVersion(): Promise<string> {
  const res = await fetchWithRetry(BOOTSTRAP_URL);
  const data: any = await res.json();
  const clientArtifact = (data.artifacts ?? []).find((a: any) => /^client-/.test(a.name));
  if (!clientArtifact) throw new Error("bootstrap.json: no client artifact found");
  const match = /^client-(.+)\.jar$/.exec(clientArtifact.name);
  if (!match) throw new Error(`bootstrap.json: unexpected client artifact name ${clientArtifact.name}`);
  return match[1];
}

// The manifest file is a signed payload: a 4-byte big-endian signature
// length, the signature bytes, then the JSON body.
async function getManifest(version: string): Promise<Manifest> {
  const url = `https://repo.runelite.net/plugins/manifest/${version}_full.js`;
  const res = await fetchWithRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const sigLen = buf.readUInt32BE(0);
  const jsonText = buf.subarray(4 + sigLen).toString("utf8");
  return JSON.parse(jsonText);
}

async function getInstallCounts(version: string): Promise<Record<string, number>> {
  const url = `https://api.runelite.net/runelite-${version}/pluginhub`;
  const res = await fetchWithRetry(url);
  return res.json();
}

// Resolves each plugin's real GitHub owner from the plugin-hub submission
// file (`repository=<git url>`), which is the authoritative mapping -- the
// manifest's free-text `author` field is a display name, not guaranteed to
// match the submitter's GitHub login.
async function resolveRepoOwners(internalNames: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let index = 0;

  async function worker() {
    while (index < internalNames.length) {
      const name = internalNames[index++];
      try {
        const res = await fetch(`${REPO_RAW_BASE}/${name}`);
        if (!res.ok) continue;
        const text = await res.text();
        const repoMatch = /^repository\s*=\s*(\S+)/m.exec(text);
        if (!repoMatch) continue;
        const repoUrl = repoMatch[1].trim().replace(/\.git$/, "");
        const ownerMatch = /github\.com[:/]([^/]+)\//i.exec(repoUrl);
        if (!ownerMatch) continue;
        map.set(name, ownerMatch[1]);
      } catch {
        // best-effort metadata lookup; fall back to the manifest author below
      }
    }
  }

  await Promise.all(Array.from({ length: REPO_CONCURRENCY }, worker));
  return map;
}

// A handful of plugin-hub submissions credit more than one person in the
// free-text `author` field (comma/"and"/"&"/"/" separated) rather than
// one name -- split it so each gets their own tracked author entity
// instead of being squashed into one garbled display string.
function splitAuthorNames(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (/^https?:\/\//i.test(trimmed)) return [trimmed];

  const parts = trimmed
    .split(/\s*,\s*|\s+(?:and|&)\s+|\s*\/\s*/gi)
    .map((s) => s.replace(/^(?:and|&)\s+/i, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

const GITHUB_USERNAME_RE = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;

// The verified repo owner (from resolveRepoOwners, below) always leads the
// list; any other split name not already covered by it tags along after.
function buildAuthorList(rawAuthor: string, verifiedOwner: string | undefined): string[] {
  const names = splitAuthorNames(rawAuthor);
  if (!verifiedOwner) return names;
  const idx = names.findIndex((n) => n.toLowerCase() === verifiedOwner.toLowerCase());
  if (idx === 0) return names;
  if (idx === -1) return [verifiedOwner, ...names];
  const reordered = [...names];
  reordered.splice(idx, 1);
  return [verifiedOwner, ...reordered];
}

export async function fetchAllRuneLitePlugins(): Promise<IngestedMod[]> {
  const version = await getClientVersion();
  const [manifest, installCounts] = await Promise.all([getManifest(version), getInstallCounts(version)]);

  // jars[] is the set of plugins that currently build/install; display[]
  // includes historically-submitted plugins that may be broken right now.
  const installable = new Set(manifest.jars.map((j) => j.internalName));
  const active = manifest.display.filter((p) => installable.has(p.internalName));

  const existing = await getExistingNameIds("runelite");
  const unresolved = active.map((p) => p.internalName).filter((name) => !existing.has(name));
  const ownerMap = unresolved.length > 0 ? await resolveRepoOwners(unresolved) : new Map<string, string>();

  // buildAuthorList is pure/sync, so the per-plugin co-author lists can all
  // be worked out up front -- that's what lets every external id this run
  // needs (one per plugin, one per co-author name, thousands total across
  // the catalog) be resolved in a single batched round trip below instead
  // of one getOrCreateExternalId call per plugin and per co-author name.
  const namesByPlugin = new Map(active.map((p) => [p.internalName, buildAuthorList(p.author, ownerMap.get(p.internalName))]));
  const idEntries: { kind: "plugin" | "author"; externalKey: string }[] = [
    ...active.map((p) => ({ kind: "plugin" as const, externalKey: p.internalName })),
    ...[...namesByPlugin.values()].flat().map((name) => ({ kind: "author" as const, externalKey: name })),
  ];
  const ids = await getOrCreateExternalIds("runelite", idEntries);

  const mods: IngestedMod[] = [];
  for (const p of active) {
    const id = ids.get(`plugin:${p.internalName}`)!;
    const verifiedOwner = ownerMap.get(p.internalName);
    const names = namesByPlugin.get(p.internalName)!;
    const installCount = installCounts[p.internalName] ?? 0;

    const coAuthors: CoAuthorIngest[] = names.map((name) => {
      const authorId = ids.get(`author:${name}`)!;
      // Only the repo-verified owner, or a name shaped like a real GitHub
      // handle, gets an avatar/profile guess -- casual co-author credits
      // ("Darts", "JC A") aren't guaranteed to be real logins.
      const isResolvable = name === verifiedOwner || GITHUB_USERNAME_RE.test(name);
      return {
        authorId,
        name,
        avatarUrl: isResolvable ? `https://github.com/${name}.png` : null,
        profileUrl: isResolvable ? `https://github.com/${name}` : null,
      };
    });
    const primary = coAuthors[0];

    mods.push({
      game: "runelite",
      id,
      nameId: p.internalName,
      name: p.displayName,
      authorId: primary.authorId,
      authorName: primary.name,
      authorProfileUrl: primary.profileUrl ?? `https://github.com/${primary.name}`,
      authorAvatarUrl: primary.avatarUrl,
      coAuthors,
      profileUrl: `${PLUGIN_HUB_BASE}/${p.internalName}`,
      tags: p.tags ?? [],
      logoUrl: p.iconHash ? `${ICON_BASE}/${p.internalName}_${p.iconHash}.png` : null,
      summary: p.description ?? "",
      dateAdded: p.createdAt,
      dateUpdated: p.lastUpdatedAt,
      downloadsTotal: installCount,
      downloadsToday: 0,
      subscribersTotal: installCount,
      popularityRankPosition: null,
      ratingsTotal: 0,
      ratingsPositive: 0,
      ratingsNegative: 0,
      ratingsPercentagePositive: 0,
      ratingsDisplayText: "",
    });
  }
  return mods;
}
