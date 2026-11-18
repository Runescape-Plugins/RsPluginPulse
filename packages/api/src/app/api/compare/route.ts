import { getCompareData, getLatestSnapshotTime, type CompareMetric, type CompareRange, type CompareType } from "@rspluginpulse/db";
import { CACHE_CEILING, remember, rememberBriefly } from "@/lib/cache";
import { jsonWithCors, OPTIONS as corsOptions } from "@/lib/cors";
import { isInt4 } from "@/lib/validate";

export const OPTIONS = corsOptions;

const TYPES: CompareType[] = ["plugin", "author"];
const METRICS: CompareMetric[] = ["total", "daily", "subs"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const typeParam = searchParams.get("type") ?? "plugin";
  if (!TYPES.includes(typeParam as CompareType)) {
    return jsonWithCors({ error: { status: 400, message: "type must be one of: plugin, author" } }, { status: 400 });
  }
  const type = typeParam as CompareType;

  const metricParam = searchParams.get("metric") ?? "total";
  if (!METRICS.includes(metricParam as CompareMetric)) {
    return jsonWithCors({ error: { status: 400, message: "metric must be one of: total, daily, subs" } }, { status: 400 });
  }
  const metric = metricParam as CompareMetric;

  const rangeParam = searchParams.get("range") ?? "90";
  const range: CompareRange = rangeParam === "all" ? "all" : rangeParam === "30" ? 30 : 90;

  const keysParam = searchParams.get("keys");
  if (!keysParam) {
    return jsonWithCors({ error: { status: 400, message: "keys is required" } }, { status: 400 });
  }
  const keys = keysParam
    .split(",")
    .map((k) => Number(k.trim()))
    .filter((k) => isInt4(k));
  if (keys.length === 0) {
    return jsonWithCors({ error: { status: 400, message: "keys must be a comma-separated list of ids" } }, { status: 400 });
  }
  if (keys.length > 4) {
    return jsonWithCors({ error: { status: 400, message: "keys accepts at most 4 ids" } }, { status: 400 });
  }

  const freshness = (await rememberBriefly("freshness:global", () => getLatestSnapshotTime())) ?? "none";
  const sortedKeys = [...keys].sort((a, b) => a - b).join(",");
  const result = await remember(`compare:${type}:${metric}:${range}:${sortedKeys}`, CACHE_CEILING.ENTITY, freshness, () =>
    getCompareData(type, keys, metric, range),
  );
  return jsonWithCors(result);
}
