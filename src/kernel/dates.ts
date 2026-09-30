export type WeekStartDay = 0 | 1;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export function startOfWeek(d: Date, weekStartDay: WeekStartDay = 1): Date {
  return addDays(startOfDay(d), -((d.getDay() - weekStartDay + 7) % 7));
}
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dateKey(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** ISO(日期或日期时间)按天平移,保留时刻部分。 */
export function shiftIsoDays(iso: string, days: number): string {
  const d = parseLocal(iso);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return iso.includes("T") ? `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : date;
}

export function parseLocal(s: string): Date {
  if (s.includes("T")) return new Date(s);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function isAtToday(tab: string, anchor: Date, today: Date, weekStartDay: WeekStartDay): boolean {
  if (tab === "week") return startOfWeek(anchor, weekStartDay).getTime() === startOfWeek(today, weekStartDay).getTime();
  if (tab === "month" || tab === "stats")
    return anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
  return startOfDay(anchor).getTime() === startOfDay(today).getTime();
}
export function shiftAnchor(tab: string, anchor: Date, dir: 1 | -1, weekStartDay: WeekStartDay): Date {
  void weekStartDay;
  if (tab === "week") return addDays(anchor, dir * 7);
  if (tab === "month" || tab === "stats") {
    const m = anchor.getMonth() + dir;
    const dim = new Date(anchor.getFullYear(), m + 1, 0).getDate();
    return new Date(anchor.getFullYear(), m, Math.min(anchor.getDate(), dim));
  }
  return addDays(anchor, dir);
}
export function formatTitle(tab: string, anchor: Date, lang: string): string {
  if (tab === "month" || tab === "stats") return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
  if (tab === "week") {
    const end = addDays(startOfWeek(anchor, 1), 6);
    const zh = lang === "zh";
    const a = `${anchor.getMonth() + 1}月${anchor.getDate()}日`;
    const b = `${end.getMonth() + 1}月${end.getDate()}日`;
    return zh ? `${a} – ${b}` : `${anchor.getMonth() + 1}/${anchor.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  }
  return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月${anchor.getDate()}日`;
}

/**
 * 非法结束时间(endsAt <= startsAt,历史跨午夜取模 bug 所致)归一化:
 * 结束落在 00:00 → 次日零点(保留"到午夜"语义);其余 → 开始 + 1 小时。
 */
export function normalizeEnd(startsAt: string, endsAt: string): string {
  if (endsAt > startsAt) return endsAt; // 合法区间:原样返回
  if (/T00:00(:00)?$/.test(endsAt)) return shiftIsoDays(endsAt, 1); // 落在零点的非法值 → 次日零点(保留"到午夜"语义)
  const d = parseLocal(startsAt); // 其余非法(相等/倒挂)→ 开始 + 1 小时
  d.setTime(d.getTime() + 60 * 60_000);
  return toLocalIso(d);
}
