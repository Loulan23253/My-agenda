import { t } from "../l10n/strings";
import { addDays, startOfDay, type WeekStartDay } from "../kernel/dates";

export interface DateStripOptions {
  anchor: Date;
  today: Date;
  weekStartDay: WeekStartDay;
  eventDays: Set<string>;
  onSelect(day: Date): void;
}

function key(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function renderDateStrip(container: HTMLElement, opts: DateStripOptions): void {
  const strip = document.createElement("div");
  strip.className = "ag2-datestrip";
  const days = document.createElement("div");
  days.className = "ag2-strip-days";
  strip.appendChild(days);

  const todayK = key(startOfDay(opts.today));
  const selK = key(startOfDay(opts.anchor));
  const weekStart = startOfDay(opts.anchor);
  const first = addDays(weekStart, -((weekStart.getDay() - opts.weekStartDay + 7) % 7));

  const labels = t("weekday.short").split(",");
  for (let i = 0; i < 7; i++) {
    const day = addDays(first, i);
    const k = key(day);
    const cell = document.createElement("div");
    cell.className = "ag2-stripcell";
    const dow = document.createElement("div");
    dow.className = "ag2-strip-dow";
    dow.textContent = labels[day.getDay()];
    cell.appendChild(dow);
    const num = document.createElement("div");
    num.className = "ag2-strip-num";
    num.textContent = String(day.getDate());
    if (k === todayK) num.classList.add("is-today");
    if (k === selK) num.classList.add("is-selected");
    cell.appendChild(num);
    if (opts.eventDays.has(k)) {
      const dot = document.createElement("div");
      dot.className = "ag2-strip-dot";
      cell.appendChild(dot);
    }
    cell.addEventListener("click", () => opts.onSelect(day));
    days.appendChild(cell);
  }
  container.appendChild(strip);
}
