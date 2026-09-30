/**
 * 日记注入:把当天日程以 `>>- [ ]` 待办清单注入到标记行之后。
 * 幂等:已有注入块时 force=false 跳过、force=true 重建;绝不触碰用户内容。
 */
import type { Occurrence } from "../core/occurrences";

const INJECT_MARK = "<!--ag2-injected-->";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function markerRe(marker: string): RegExp {
  return new RegExp("^" + escapeRe(marker) + "(\\s*" + escapeRe(INJECT_MARK) + ")?[ \\t]*$", "m");
}

export interface InjectItem {
  title: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  place?: string;
  category?: string;
}

export function buildInjectList(occs: Occurrence[]): InjectItem[] {
  return normalizeItems(occs.map((o) => ({
    title: o.event.title,
    allDay: o.event.isAllDay,
    startTime: o.event.isAllDay ? undefined : o.start.slice(11, 16),
    endTime: o.event.isAllDay || !o.end ? undefined : o.end.slice(11, 16),
    place: o.event.place,
    category: o.event.category,
  })));
}

function normalizeItems(items: InjectItem[]): InjectItem[] {
  const seen = new Map<string, InjectItem>();
  for (const it of items) {
    const key = it.title + "|" + (it.startTime ?? "");
    if (!seen.has(key)) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
}

export interface InjectFormat {
  /** 条目用勾选框(否则无框)。 */
  checkbox: boolean;
  /** 显示地点。 */
  place: boolean;
  /** 显示分类。 */
  category: boolean;
  /** 行前缀:">>"(嵌套引用,默认)或 ">"。 */
  prefix: string;
  /** 时间制式(默认 24h)。 */
  timeFormat?: "24h" | "12h";
}

export type InjectStatus = "injected" | "cleared" | "no-events" | "no-marker" | "skipped";

/** 从旧注入行提取 "时刻前缀+标题" 键(剥掉勾选框/📍/🏷️),用于重建时保留勾选状态。 */
function checkedKeysFrom(oldBlock: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of oldBlock) {
    const m = /^>>?-\s*\[x\]\s+(.*)$/.exec(line.trim()); // 兼容历史 >>(保留);新前缀由 itemKey 侧无关
    if (!m) continue;
    keys.add(itemKey(m[1].replace(/\s*\u{1F4CD}[^\u{1F4CD}]*$/u, "").replace(/\s*\u{1F3F7}[^\u{1F3F7}]*$/u, "").trimEnd()));
  }
  return keys;
}

function itemKey(text: string): string {
  // "09:00-09:30 标题" / "10:00 标题" / "标题"
  const m = /^(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)\s+(.*)$/.exec(text);
  return m ? `${m[1]}|${m[2]}` : `|${text}`;
}

export function applyInjection(
  content: string,
  opts: { marker: string; items: InjectItem[]; force?: boolean; preserveChecked?: boolean; format?: InjectFormat },
): { content: string; status: InjectStatus; count?: number } {
  const mm = content.match(markerRe(opts.marker));
  if (!mm) return { content, status: "no-marker" };
  const start = mm.index;
  let lineEnd = content.indexOf("\n", start);
  if (lineEnd === -1) lineEnd = content.length;
  const markerLine = content.slice(start, lineEnd).replace(new RegExp(">?\\s*" + escapeRe(INJECT_MARK) + "\\s*$"), "");

  if (content.includes(INJECT_MARK) && !opts.force) return { content, status: "skipped" };

  const after = content.slice(lineEnd === content.length ? content.length : lineEnd + 1).split("\n");
  let keep = 0;
  for (let i = 0; i < after.length; i++) {
    const trimmed = after[i].trim();
    if (trimmed.includes(INJECT_MARK) || (trimmed.startsWith(">") && /^>>?-\s/.test(trimmed))) keep = i + 1;
    else break;
  }
  const rest = after.slice(keep).join("\n").replace(/^\n+/, "");
  const oldBlock = after.slice(0, keep);

  const list = normalizeItems(opts.items);
  const checked = opts.preserveChecked ? checkedKeysFrom(oldBlock) : new Set<string>();
  if (list.length === 0) {
    if (opts.force && (keep > 0 || content.includes(INJECT_MARK)))
      return { content: content.slice(0, start) + markerLine + "\n" + rest, status: "cleared" };
    return { content, status: "no-events" };
  }

  const fmt = { checkbox: true, place: true, category: true, prefix: ">>", timeFormat: "24h" as const, ...(opts.format ?? {}) };
  const hhmm12 = (t: string): string => {
    const [h, m] = t.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };
  const lines = [">" + INJECT_MARK];
  for (const it of list) {
    let time = "";
    if (!it.allDay && it.startTime && !/^\d{1,2}:\d{2}/.test(it.title)) {
      if (fmt.timeFormat === "12h") {
        time = (it.endTime ? `${hhmm12(it.startTime)}-${hhmm12(it.endTime)}` : hhmm12(it.startTime)) + " ";
      } else {
        time = it.endTime ? `${it.startTime}-${it.endTime} ` : `${it.startTime} `;
      }
    }
    const place = it.place && fmt.place ? "📍" + it.place + " " : "";
    const cat = it.category && fmt.category ? "🏷️" + it.category + " " : "";
    const box = fmt.checkbox ? (checked.has(itemKey(`${time}${it.title}`.trimEnd())) ? "[x]" : "[ ]") : "";
    const pfx = `${fmt.prefix}- ${box ? box + " " : ""}`;
    lines.push(`${pfx}${time}${it.title} ${place}${cat}`.trimEnd());
  }
  const block = lines.join("\n");
  const head = content.slice(0, start) + markerLine + "\n";
  return { content: head + (rest ? block + "\n\n" + rest : block + "\n"), status: "injected", count: list.length };
}
