import { t } from "../l10n/strings";
import { addDays } from "../kernel/dates";
import type { Occurrence } from "./occurrences";
import { parseLocal, dateKey, startOfDay } from "../kernel/dates";

/** 日程文本(复制/插入用):按天分组,"- HH:MM–HH:MM 标题 📍地点"。 */
export function buildAgendaText(occs: Occurrence[], today: Date): string {
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occs) {
    const k = dateKey(parseLocal(o.start));
    const list = byDay.get(k) ?? [];
    list.push(o);
    byDay.set(k, list);
  }
  const lines: string[] = [];
  const tomorrowKey = dateKey(addDays(startOfDay(today), 1));
  for (const [k, list] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const d = parseLocal(k);
    const w = "日一二三四五六"[d.getDay()];
    const label =
      k === dateKey(startOfDay(today))
        ? t("panel.today")
        : k === tomorrowKey
          ? t("panel.tomorrow")
          : `${d.getMonth() + 1}月${d.getDate()}日 周${w}`;
    lines.push(`**${label}**`);
    for (const o of list) {
      const time = o.event.isAllDay
        ? t("panel.allDay")
        : o.end
          ? `${o.start.slice(11, 16)}–${o.end.slice(11, 16)}`
          : o.start.slice(11, 16);
      lines.push(`- ${time} ${o.event.title}${o.event.place ? ` 📍${o.event.place}` : ""}`);
    }
    lines.push("");
  }
  return lines.length ? lines.join("\n").trimEnd() : t("panel.searchNoResults");
}
