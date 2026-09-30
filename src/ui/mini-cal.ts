/**
 * 迷你日历(日视图侧栏):双月堆叠、事件圆点、今天描圈、选中填充。
 * 纯原生 DOM(与视图层一致),点击日期由面板接管导航。
 */
import { t, getLang } from "../l10n/strings";
import { addDays, dateKey, startOfWeek, type WeekStartDay } from "../kernel/dates";

export interface MiniCalOptions {
  /** 所选日期(高亮)。 */
  anchor: Date;
  today: Date;
  weekStartDay: WeekStartDay;
  eventDays: Set<string>;
  onSelect(day: Date): void;
  /** 堆叠的月数(默认 2:上月 + 当前月)。 */
  months?: number;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function renderMiniCal(container: HTMLElement, opts: MiniCalOptions): void {
  const count = Math.max(1, opts.months ?? 2);
  const todayK = dateKey(opts.today);
  const selK = dateKey(opts.anchor);

  for (let i = -1; i < count - 1; i++) {
    const first = new Date(opts.anchor.getFullYear(), opts.anchor.getMonth() + i, 1);
    const wrap = document.createElement("div");
    wrap.className = "ag2-minical";

    const head = document.createElement("div");
    head.className = "ag2-minical-head";
    head.textContent =
      getLang() === "zh"
        ? `${first.getFullYear()}年${first.getMonth() + 1}月`
        : `${MONTHS_EN[first.getMonth()]} ${first.getFullYear()}`;
    wrap.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "ag2-minical-grid";
    const labels = t("weekday.short").split(",");
    const order = opts.weekStartDay === 0 ? labels : [...labels.slice(1), labels[0]];
    for (const l of order) {
      const dow = document.createElement("div");
      dow.className = "ag2-minical-dow";
      dow.textContent = l;
      grid.appendChild(dow);
    }

    const y = first.getFullYear();
    const m = first.getMonth();
    const firstCell = startOfWeek(first, opts.weekStartDay);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const offset = Math.round((first.getTime() - firstCell.getTime()) / 86400000);
    const rows = Math.ceil((offset + daysInMonth) / 7);
    for (let r = 0; r < rows * 7; r++) {
      const day = addDays(firstCell, r);
      const cell = document.createElement("div");
      cell.className = "ag2-minical-cell";
      if (day.getMonth() !== m) cell.classList.add("is-other");
      const num = document.createElement("div");
      num.className = "ag2-minical-num";
      num.textContent = String(day.getDate());
      const k = dateKey(day);
      if (k === todayK) num.classList.add("is-today");
      if (k === selK) num.classList.add("is-selected");
      cell.appendChild(num);
      if (opts.eventDays.has(k) && day.getMonth() === m) {
        const dot = document.createElement("div");
        dot.className = "ag2-minical-dot";
        cell.appendChild(dot);
      }
      cell.addEventListener("click", () => opts.onSelect(day));
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }
}
