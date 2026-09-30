import type { CalendarEvent } from "../model/event";
import { buildIcs } from "../core/ics-export";

/** 单条事件 → 完整 VCALENDAR(CalDAV PUT 用)。 */
export function buildSingleIcs(ev: CalendarEvent): string {
  return buildIcs([ev]);
}
