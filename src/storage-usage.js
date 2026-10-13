const bytes = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

// These APIs measure different scopes. Do not add their results into a disk total.
// https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/getBytesInUse
export async function storageUsage(manager, local) {
  const [estimate, localSize] = await Promise.allSettled([
    Promise.resolve().then(() => manager?.estimate?.()),
    Promise.resolve().then(() => local?.getBytesInUse?.(null))
  ]);
  return {
    usage: bytes(estimate.status === "fulfilled" ? estimate.value?.usage : undefined),
    quota: bytes(estimate.status === "fulfilled" ? estimate.value?.quota : undefined),
    local: bytes(localSize.status === "fulfilled" ? localSize.value : undefined)
  };
}

export function formatBytes(value) {
  if (bytes(value) === null) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const power = value > 0 ? Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)) : 0;
  return `${new Intl.NumberFormat(undefined, {maximumFractionDigits: power === 0 ? 0 : 1}).format(value / 1024 ** power)} ${units[power]}`;
}
