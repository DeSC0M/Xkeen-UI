// Pure, bounded observability helpers. No timers, storage, or router requests.
export function metricNumber(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function selectHistory(history, minutes) {
  const end = history.at(-1)?.at;
  if (!Number.isFinite(end)) return [];
  return history.filter((point) => point.at >= end - minutes * 60);
}

export function nearestPointIndex(points, at) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].at < at) low = middle + 1;
    else high = middle;
  }
  return low > 0 && at - points[low - 1].at < points[low].at - at ? low - 1 : low;
}

export function collectionGap(previous, current) {
  if (!previous || !current) return null;
  const seconds = current.at - previous.at;
  const expected = Math.max(5, metricNumber(previous.period) || 5, metricNumber(current.period) || 5);
  return seconds > Math.max(15, expected * 2.5)
    ? { from: previous.at, to: current.at, seconds }
    : null;
}

export function historyGaps(points) {
  return points.slice(1).map((point, index) => collectionGap(points[index], point)).filter(Boolean);
}

export function gapAtTime(points, at) {
  return historyGaps(points).find((gap) => at > gap.from && at < gap.to) || null;
}

export function selectClients(payload, showAll) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const top = Array.isArray(payload?.top) ? payload.top : items;
  return (showAll ? items : top).slice(0, showAll ? 100 : 5);
}

export function resourceHealth(payload, dnsDiagnostics) {
  const internet = payload?.router?.internet;
  const conntrack = payload?.router?.conntrack;
  const dnsError = (dnsDiagnostics || internet?.dns_diagnostics)?.state === "error";
  const issues = [];
  let severity = 0;
  for (const [label, value] of [
    ["CPU", payload?.cpu?.percent],
    ["RAM", payload?.memory?.percent],
    ["Диск", payload?.storage?.total_bytes ? payload?.storage?.percent : null],
    ["Conntrack", conntrack?.available ? conntrack.percent : null],
  ]) {
    const number = metricNumber(value);
    if (number !== null && number >= 75) {
      issues.push(`${label} ${number.toFixed(1)}%`);
      severity = Math.max(severity, number >= 90 ? 2 : 1);
    }
  }
  if (internet?.available) {
    for (const [key, label] of [
      ["internet", "Интернет недоступен"],
      ["gateway", "Шлюз недоступен"],
      ["dns", "DNS недоступен"],
      ["captive", "Требуется авторизация сети"],
    ]) {
      // Router normalization exposes captive=true when no portal intercepts.
      if (internet[key] === false) { issues.push(label); severity = 2; }
    }
  }
  if (dnsError) { issues.push("Ошибка DoH/DoT"); severity = 2; }
  const incomplete = metricNumber(payload?.cpu?.percent) === null ||
    metricNumber(payload?.memory?.percent) === null ||
    !internet?.available ||
    ["internet", "gateway", "dns", "captive"].some((key) => typeof internet?.[key] !== "boolean") ||
    payload?.router?.freshness?.state === "stale";
  return {
    tone: severity === 2 ? "danger" : severity === 1 ? "warning" : incomplete ? "unknown" : "normal",
    title: dnsError ? "Проблема с зашифрованным DNS" : severity ? "Требуется внимание" : incomplete ? "Телеметрия неполная" : "Система в норме",
    note: issues.join(" · ") || (incomplete ? "Часть проверок недоступна или устарела — это не подтверждение исправности" : "Критических сигналов не обнаружено"),
  };
}

export function buildResourceSnapshot(payload, history, rangeMinutes, pollMs, stale) {
  // Explicit allowlist: never export router identifiers, IPs, MACs, clients,
  // logs, process arguments, modem data, paths, or arbitrary future API fields.
  const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, metricNumber(source?.[key])]));
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    sampled_at: metricNumber(payload?.sampled_at),
    range_minutes: rangeMinutes,
    refresh_seconds: pollMs / 1000,
    stale,
    history_scope: "current_browser_tab",
    network_scope: "sum_of_interfaces_may_include_duplicates",
    resources: {
      cpu: pick(payload?.cpu, ["percent", "cores", "load_1m", "load_5m", "load_15m", "runnable_tasks", "total_tasks"]),
      memory: pick(payload?.memory, ["percent", "total_bytes", "used_bytes", "available_bytes", "swap_total_bytes", "swap_used_bytes"]),
      storage: pick(payload?.storage, ["percent", "total_bytes", "used_bytes", "free_bytes"]),
      network: pick(payload?.network, ["receive_bytes_per_second", "send_bytes_per_second", "received_bytes", "sent_bytes"]),
      temperature_celsius: metricNumber(payload?.temperature_celsius),
      uptime_seconds: metricNumber(payload?.uptime_seconds),
    },
    history: selectHistory(history, rangeMinutes).map((point) => pick(point, [
      "at", "period", "cpu", "load1", "load5", "load15", "memory", "swap", "receive", "send",
    ])),
  };
}
