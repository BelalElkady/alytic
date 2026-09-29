/**
 * Which other accounts each user shares a network address with, for the admin
 * users table's "same network" warning. Only the two addresses the users table
 * keeps are compared (signup_ip and last_login_ip), so a match means one of
 * those two lines up, not that the accounts were ever online together.
 *
 * A match is a hint, not proof: a household, an office Wi-Fi or a mobile
 * carrier's shared address (CGNAT) puts unrelated people behind one IP.
 * Staff and the system account are left out on both sides — an admin who
 * signs a customer up from the office would otherwise flag them.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1']);

const ipsOf = (u) =>
  [...new Set([u.signup_ip, u.last_login_ip].filter((ip) => ip && !LOOPBACK.has(ip)))];

/**
 * @param {Array<{id: string, email: string, name?: string|null, signup_ip?: string|null,
 *   last_login_ip?: string|null, is_admin?: boolean, is_marketer?: boolean}>} users
 * @param {{ excludeIds?: string[] }} [options]
 * @returns {Map<string, Array<{id: string, email: string, name: string|null, ips: string[]}>>}
 *   user id -> the other accounts on a shared address, with the addresses they share.
 */
export function sharedIpAccounts(users, { excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds);
  const customers = users.filter((u) => !u.is_admin && !u.is_marketer && !excluded.has(u.id));

  const byIp = new Map();
  for (const u of customers) {
    for (const ip of ipsOf(u)) {
      if (!byIp.has(ip)) byIp.set(ip, []);
      byIp.get(ip).push(u);
    }
  }

  const result = new Map();
  for (const u of customers) {
    const others = new Map();
    for (const ip of ipsOf(u)) {
      for (const other of byIp.get(ip)) {
        if (other.id === u.id) continue;
        if (!others.has(other.id)) {
          others.set(other.id, { id: other.id, email: other.email, name: other.name ?? null, ips: [] });
        }
        others.get(other.id).ips.push(ip);
      }
    }
    if (others.size) result.set(u.id, [...others.values()]);
  }
  return result;
}
