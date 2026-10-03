import ICAL from "ical.js";
import type { CalendarEvent } from "../model/event";

export interface Occurrence {
  event: CalendarEvent;
  start: string;
  end?: string;
}

export function parseLocal(s: string): Date {
  if (s.includes("T")) return new Date(s);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(d: Date): string {
  return `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function expandSingle(ev: CalendarEvent, from: Date, to: Date): Occurrence[] {
  const start = parseLocal(ev.startsAt);
  const end = ev.endsAt ? parseLocal(ev.endsAt) : undefined;
  const out: Occurrence[] = [];
  if (ev.isAllDay) {
    if (!end || end.getTime() === startOfDay(start).getTime()) {
      if (start >= from && start < to) out.push({ event: ev, start: ev.startsAt, end: ev.endsAt });
      return out;
    }
    for (let d = startOfDay(start); d < end; d = addDays(d, 1)) {
      if (d >= to) break;
      if (d >= from) out.push({ event: ev, start: fmtDate(d), end: fmtDate(addDays(d, 1)) });
    }
    return out;
  }
  if (!end) {
    if (start >= from && start < to) out.push({ event: ev, start: ev.startsAt, end: ev.endsAt });
    return out;
  }
  for (let day = startOfDay(start); day <= startOfDay(end); day = addDays(day, 1)) {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    if (dayStart >= to) break;
    if (dayEnd <= from) continue;
    const cs = start > dayStart ? start : dayStart;
    const ce = end < dayEnd ? end : dayEnd;
    if (cs < ce) out.push({ event: ev, start: fmtDateTime(cs), end: fmtDateTime(ce) });
  }
  return out;
}

function toIcalTime(iso: string, allDay: boolean): ICAL.Time {
  return allDay ? ICAL.Time.fromDateString(iso) : ICAL.Time.fromDateTimeString(iso);
}

export function expandOccurrences(events: CalendarEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    if (!ev.repeats?.rule) {
      out.push(...expandSingle(ev, from, to));
      continue;
    }
    // 排除实例:兼容完整时刻与纯日期两种存法(拖拽"仅此实例"写纯日期)
    const excludedFull = new Set((ev.skippedDates ?? []).map((s) => s.replace("Z", "")));
    const excludedDay = new Set([...excludedFull].map((s) => s.slice(0, 10)));
    const dtstart = toIcalTime(ev.startsAt, ev.isAllDay);
    const duration = ev.endsAt ? toIcalTime(ev.endsAt, ev.isAllDay).subtractDate(dtstart) : null;
    // DTSTART 远早于窗口时按频率粗跳(保守向下取整,停在窗口前留余量),
    // 避免 10000 次 guard 耗尽导致老重复事件静默消失;iterator 从停点精细补齐
    const daysBehind = (from.getTime() - dtstart.toJSDate().getTime()) / 86_400_000;
    if (daysBehind > 400) {
      const freq = (ev.repeats?.rule.toUpperCase().match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/) ?? [])[1];
      if (freq) {
        const chunk: Record<string, number> = { DAILY: 28, WEEKLY: 196, MONTHLY: 335, YEARLY: 3650 };
        const steps = Math.max(0, Math.floor(daysBehind / (chunk[freq] ?? 28)) - 2);
        for (let i = 0; i < steps; i++) dtstart.day += chunk[freq] ?? 28;
      }
    }
    let iter: ICAL.RecurIterator;
    try {
      iter = ICAL.Recur.fromString(ev.repeats.rule).iterator(dtstart);
    } catch {
      continue;
    }
    let next = iter.next();
    let guard = 0;
    while (next && guard < 10_000) {
      guard++;
      const jsDate = next.toJSDate();
      if (jsDate >= to) break;
      if (jsDate >= from) {
        const startIso = next.toString().replace("Z", "");
        if (!excludedFull.has(startIso) && !excludedDay.has(startIso.slice(0, 10))) {
          let endIso: string | undefined;
          if (duration) {
            const c = next.clone();
            c.addDuration(duration);
            endIso = c.toString().replace("Z", "");
          }
          out.push({ event: ev, start: startIso, end: endIso });
        }
      }
      next = iter.next();
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
