export const GETRO_HOSTS = [];

export function isAllowedGetroHost(host) {
  if (!host || typeof host !== "string") return false;
  return GETRO_HOSTS.includes(host.toLowerCase());
}
