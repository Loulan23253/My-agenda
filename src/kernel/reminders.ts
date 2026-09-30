import type { CalendarEvent } from "../model/event";
import { expandOccurrences } from "../core/occurrences";

export interface DueReminder {
  id: string;
  title: string;
  startIso: string;
  dueIso: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function localIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 刚到点的提醒(due ∈ (now-回溯, now]):供轮询触发;过早的绝不提前发,过点太久的不再补发。 */
export function dueReminders(events: CalendarEvent[], now: Date, lookbackMs = 120_000): DueReminder[] {
  const out: DueReminder[] = [];
  const nowMs = now.getTime();
  // 展开窗口:提醒分钟数有上限(设置里 -1..任意),取宽裕的 ±2 天足够覆盖任何提前量
  const windowStart = new Date(nowMs - 24 * 3600_000);
  const windowEnd = new Date(nowMs + 2 * 24 * 3600_000);
  for (const ev of events) {
    const minutes = ev.reminderMinutes ?? [];
    if (!minutes.length || !ev.startsAt) continue;
    for (const occ of expandOccurrences([ev], windowStart, windowEnd)) {
      const startMs = new Date(occ.start).getTime();
      for (const m of minutes) {
        const dueMs = startMs - m * 60_000;
        if (dueMs <= nowMs && dueMs > nowMs - lookbackMs) {
          out.push({ id: ev.id, title: ev.title, startIso: occ.start, dueIso: localIso(new Date(dueMs)) });
        }
      }
    }
  }
  return out.sort((a, b) => (a.dueIso < b.dueIso ? -1 : 1));
}
