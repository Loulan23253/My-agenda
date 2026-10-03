import { t } from "../l10n/strings";
import ICAL from "ical.js";
import type { CalendarEvent } from "../model/event";

/** iCalendar 文本 → v2 事件(取 VEVENT;VALARM 映射为提醒分钟)。 */
export function parseIcsToEvents(icsText: string, idPrefix = ""): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const jcal: unknown = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal as string | unknown[]);
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(vevent);
    const uid = ev.uid;
    if (!uid) continue;
    const start = ev.startDate;
    if (!start) continue; // 缺 DTSTART 的坏块:跳过,不拖垮整轮解析
    const end = ev.endDate;
    const isAllDay = start.isDate;
    const ev2: CalendarEvent = {
      id: idPrefix ? `${idPrefix}-${uid}` : uid,
      title: ev.summary || t("sync.untitled"),
      startsAt: isAllDay ? start.toString().slice(0, 10) : icalToLocalIso(start),
      endsAt: end ? (isAllDay ? end.toString().slice(0, 10) : icalToLocalIso(end)) : undefined,
      isAllDay,
    };
    const loc = vevent.getFirstPropertyValue("location");
    if (loc) ev2.place = String(loc);
    const desc = vevent.getFirstPropertyValue("description");
    if (desc) ev2.notes = String(desc);
    const cat = vevent.getFirstPropertyValue("categories");
    if (cat) ev2.category = String(cat).split(",")[0].trim();
    const status = vevent.getFirstPropertyValue("status");
    if (status) ev2.status = String(status).toLowerCase();
    try {
      const org = vevent.getFirstProperty("organizer");
      if (org) ev2.organizer = personFromProperty(org);
      const people: string[] = [];
      for (const a of vevent.getAllProperties("attendee")) people.push(personFromProperty(a));
      if (people.length) ev2.attendees = people;
      const url = vevent.getFirstPropertyValue("url");
      if (url) ev2.url = String(url);
    } catch {
      // 单字段解析失败不阻断整个事件
    }
    if (ev.component.hasProperty("rrule")) {
      const rr = ev.component.getFirstPropertyValue("rrule") as ICAL.Recur;
      ev2.repeats = { rule: rr.toString() };
    }
    const ex = ev.component.getAllProperties("exdate");
    if (ex.length) {
      const dates: string[] = [];
      for (const prop of ex) {
        let vals: unknown[] = [];
        try {
          vals = prop.getValues() as unknown[];
        } catch {
          continue; // 毒 EXDATE(如值类型与 DTSTART 不符):跳过该属性,不拖垮整轮解析
        }
        for (const v of vals) {
          if (v && typeof (v as ICAL.Time).toString === "function") {
            dates.push(normalizeIso((v as ICAL.Time).toString(), isAllDay));
          }
        }
      }
      if (dates.length) ev2.skippedDates = dates;
    }
    const alarms = ev.component.getAllSubcomponents("valarm");
    const minutes: number[] = [];
    for (const alarm of alarms) {
      const trigger = alarm.getFirstPropertyValue("trigger");
      if (trigger instanceof ICAL.Duration) minutes.push(-Math.round(trigger.toSeconds() / 60));
      else if (trigger instanceof ICAL.Time) {
        // 绝对时刻触发:换算成相对事件开始的分钟(早于开始为正)
        const diffMin = Math.round((trigger.toJSDate().getTime() - start.toJSDate().getTime()) / 60_000);
        if (diffMin > 0) minutes.push(diffMin);
      }
    }
    if (minutes.length) ev2.reminderMinutes = minutes;
    out.push(ev2);
  }
  return out;
}

/** 从 ORGANIZER/ATTENDEE 属性整理出 "名字 <邮箱>"(缺一项则省略)。 */
function personFromProperty(prop: ICAL.Property): string {
  let email = "";
  let name = "";
  try {
    const cn = prop.getFirstParameter("cn");
    if (cn) name = String(cn).trim();
    const val = String(prop.getFirstValue()).replace(/^mailto:/i, "").trim();
    if (val.includes("@")) email = val;
    else if (!name) name = val;
  } catch {
    return "";
  }
  if (name && email) return `${name} <${email}>`;
  return name || email;
}

/** ICAL.Time → 本地墙钟 ISO(浮时区约定,与存储格式一致)。 */
function icalToLocalIso(t: ICAL.Time): string {
  const p = (n: number) => String(n).padStart(2, "0");
  // 跨时区换算:UTC(Z)或带 TZID 的事件转为本地墙钟,否则显示错 8-13 小时
  let local = t;
  try {
    if (t.zone === ICAL.Timezone.utcTimezone) {
      local = t.convertToZone(ICAL.Timezone.localTimezone);
    } else if (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid) {
      local = ICAL.Timezone.convert_time(t, t.zone, ICAL.Timezone.localTimezone);
    }
  } catch {
    /* 换算失败按原值兜底 */
  }
  return `${local.year}-${p(local.month)}-${local.day.toString().padStart(2, "0")}T${p(local.hour)}:${p(local.minute)}:${p(local.second)}`;
}

function normalizeIso(s: string, isAllDay: boolean): string {
  return isAllDay ? s.slice(0, 10) : s.replace("Z", "");
}
