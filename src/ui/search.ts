import type { CalendarEvent } from "../model/event";

export function filterBySearch(events: CalendarEvent[], query: string): CalendarEvent[] {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter((ev) =>
    [ev.title, ev.place, ev.category, ev.notes]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join("\n")
      .toLowerCase()
      .includes(q),
  );
}
