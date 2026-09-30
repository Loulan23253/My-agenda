import { requestUrl } from "obsidian";

/** 平台无关的 HTTP 面(测试可注入)。 */
export type Http = (opts: { url: string; method: string; body?: string; headers?: Record<string, string> }) => Promise<{
  status: number;
  text: string;
  headers: Record<string, string>;
}>;

export const TIMEOUT_MS = 30_000;

export const obsidianHttp: Http = async (opts) => {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${opts.method} ${opts.url} 超时(${TIMEOUT_MS / 1000}s)`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      requestUrl({ url: opts.url, method: opts.method, headers: opts.headers, body: opts.body, throw: false }),
      timeout,
    ]);
  } finally {
    window.clearTimeout(timer);
  }
};

export interface DavAuth {
  user: string;
  pass: string;
}

export function authHeaders(auth: DavAuth, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: "Basic " + btoa(`${auth.user}:${auth.pass}`),
    ...(extra ?? {}),
  };
}

/** iCloud 发现链:全球 → 中国区,谁走通用谁。 */
export const ICLOUD_ROOTS = ["https://caldav.icloud.com", "https://caldav.icloud.com.cn"];

function abs(root: string, href: string): string {
  return /^https?:\/\//i.test(href) ? href : root.replace(/\/?$/, "/") + href.replace(/^\//, "");
}

function localName(el: Element): string {
  return el.localName ?? el.tagName.replace(/^.*:/, "");
}

/** 宽容解析:取第一个指定 localName 元素的文本。 */

function firstHrefUnder(xml: string, parentName: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (localName(all[i]) !== parentName) continue;
    const inner = all[i].getElementsByTagName("*");
    for (let j = 0; j < inner.length; j++) if (localName(inner[j]) === "href") return (inner[j].textContent || "").trim();
  }
  return null;
}

export interface DiscoveredCalendar {
  id: string;
  url: string;
  name: string;
}

export interface DiscoveryResult {
  calendars: DiscoveredCalendar[];
  root: string;
}

const XML_CT = "application/xml; charset=utf-8";

/** 发现可写 VEVENT 日历;每个根服务器独立尝试,网络错误落到下一个。 */
export async function discoverCalendars(
  http: Http,
  creds: DavAuth,
  roots: string[] = ICLOUD_ROOTS,
): Promise<DiscoveryResult> {
  let lastStatus = 0;
  let lastNetworkError: unknown;
  let sawAuthReject = false;

  for (const root of roots) {
    let principal: string | null = null;
    let home: string | null = null;
    try {
      const r1 = await http({
        url: root + "/",
        method: "PROPFIND",
        headers: authHeaders(creds, { Depth: "0", "Content-Type": XML_CT }),
        body: `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
      });
      lastStatus = r1.status;
      if (r1.status === 401 || r1.status === 403) {
        sawAuthReject = true;
        continue;
      }
      if (r1.status < 200 || r1.status >= 300) continue;
      const principalHref = firstHrefUnder(r1.text, "current-user-principal");
      if (!principalHref) continue;
      principal = abs(root, principalHref);

      const r2 = await http({
        url: principal,
        method: "PROPFIND",
        headers: authHeaders(creds, { Depth: "0", "Content-Type": XML_CT }),
        body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
      });
      lastStatus = r2.status;
      if (r2.status < 200 || r2.status >= 300) continue;
      const homeHref = firstHrefUnder(r2.text, "calendar-home-set");
      if (!homeHref) continue;
      home = abs(root, homeHref);
    } catch (e) {
      lastNetworkError = e;
      continue;
    }

    const r3 = await http({
      url: home,
      method: "PROPFIND",
      headers: authHeaders(creds, { Depth: "1", "Content-Type": XML_CT }),
      body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    }).catch((e) => {
      lastNetworkError = e;
      return null;
    });
    if (!r3) continue;
    lastStatus = r3.status;
    if (r3.status < 200 || r3.status >= 300) continue;

    const calendars = parseCalendarCollection(r3.text, home);
    return { calendars, root };
  }
  if (sawAuthReject) throw new Error(`服务器拒绝登录(HTTP ${lastStatus}):请确认使用 App 专用密码`);
  if (lastNetworkError && lastStatus === 0) {
    throw lastNetworkError instanceof Error ? lastNetworkError : new Error(String(lastNetworkError));
  }
  throw new Error(`发现失败(HTTP ${lastStatus})`);
}

/** 解析 calendar-home 的 Depth:1 multistatus,仅保留可写 VEVENT 日历集合。 */
export function parseCalendarCollection(xml: string, homeUrl: string): DiscoveredCalendar[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: DiscoveredCalendar[] = [];
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (localName(all[i]) !== "response") continue;
    const inner = all[i].getElementsByTagName("*");
    let href = "";
    let name = "";
    const types = new Set<string>();
    const comps = new Set<string>();
    for (let j = 0; j < inner.length; j++) {
      const tag = localName(inner[j]);
      if (tag === "href" && !href) href = (inner[j].textContent || "").trim();
      else if (tag === "displayname" && !name) name = (inner[j].textContent || "").trim();
      else if (tag === "resourcetype") {
        for (const k of Array.from(inner[j].getElementsByTagName("*"))) types.add(localName(k));
      } else if (tag === "supported-calendar-component-set") {
        for (const k of Array.from(inner[j].getElementsByTagName("*"))) comps.add(k.getAttribute("name") || "");
      }
    }
    if (!href || !types.has("calendar")) continue;
    if (types.has("subscribed") || types.has("schedule-inbox") || types.has("schedule-outbox")) continue;
    if (comps.size && !comps.has("VEVENT")) continue;
    const url = new URL(href, homeUrl).toString();
    const lastSeg = decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? url);
    out.push({ id: lastSeg, url, name: name || lastSeg });
  }
  return out;
}
