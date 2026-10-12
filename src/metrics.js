export const DAY = 86_400_000;

export function validTime(value, now) {
  // A sanity floor, not an inferred creation time; Firefox did not exist in 2000.
  return Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= now;
}

export function localDay(timestamp) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

export function metrics(tabs, now) {
  const result = {total: tabs.length, pinned: 0, inactive7Days: 0,
    inactive30Days: 0, unknownInactivity: 0, eligibleUnpinned: 0};
  for (const tab of tabs) {
    if (tab.pinned) { result.pinned++; continue; }
    result.eligibleUnpinned++;
    if (!validTime(tab.lastAccessedAt, now)) { result.unknownInactivity++; continue; }
    const elapsed = now - tab.lastAccessedAt;
    if (elapsed >= 7 * DAY) result.inactive7Days++;
    if (elapsed >= 30 * DAY) result.inactive30Days++;
  }
  return result;
}

// Calendar retention, not elapsed 24-hour periods (DST days can be shorter/longer).
export function retainDaily(daily, now, retentionDays) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays + 1);
  const firstDay = localDay(cutoff.getTime());
  return Object.fromEntries(Object.entries(daily).filter(([date]) => date >= firstDay));
}
