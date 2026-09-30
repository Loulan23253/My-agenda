/**
 * 自然语言快速添加弹窗:一个大输入框 + 实时解析预览(Apple 式极简)。
 * Enter 或「保存」把解析结果交给 onSave;解析不出非空标题时保存不可用。
 */

import { App, Modal, Notice } from "obsidian";
import { shiftIsoDays } from "../kernel/dates";
import { t } from "../l10n/strings";
import type { CalendarEvent } from "../model/event";
import { parseQuickAdd, type QuickAddParse } from "../core/nlp-parse";

export interface QuickAddDefaults {
  categories?: string[];
  defaultCategory?: string;
  defaultReminderMinutes?: number;
}

export interface QuickAddOptions {
  onSave: (ev: CalendarEvent) => void | Promise<void>;
  defaults: QuickAddDefaults;
}

export class QuickAddModal extends Modal {
  private readonly opts: QuickAddOptions;

  constructor(app: App, opts: QuickAddOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    this.modalEl.addClass("ag2-modal");
    const content = this.contentEl;

    // 顶部大输入框(Apple 式:无边框、加粗、置顶)
    const input = content.createEl("input", { cls: "ag2-f-title", placeholder: t("quickadd.placeholder") });
    input.type = "text";

    // 实时预览:日期 · 时刻/全天 · 时长
    const preview = content.createDiv({ cls: "ag2-quick-preview", text: t("quickadd.hint") });

    const fmtDuration = (min: number): string => (min % 60 === 0 ? `${min / 60}h` : `${min}min`);

    const buildEvent = (p: QuickAddParse): CalendarEvent => {
      const dur = p.durationMin ?? 60;
      const startsAt = p.allDay ? p.dateKey : `${p.dateKey}T${p.startHHMM}:00`;
      let endsAt: string | undefined;
      if (!p.allDay && p.startHHMM) {
        // start + duration 分钟;超过 24:00 时日期进位(23:00-00:00 → 次日 00:00)
        const [h, m] = p.startHHMM.split(":").map(Number);
        const total = h * 60 + m + dur;
        const p2 = (n: number): string => String(n).padStart(2, "0");
        const endKey = shiftIsoDays(p.dateKey, Math.floor(total / 1440));
        const rem = total % 1440;
        endsAt = `${endKey}T${p2(Math.floor(rem / 60))}:${p2(rem % 60)}:00`;
      }
      return {
        id: crypto.randomUUID() + "@myagenda",
        title: p.title,
        startsAt,
        endsAt,
        isAllDay: !p.startHHMM,
        category: p.category ?? (this.opts.defaults.defaultCategory || undefined),
        place: p.place,
        reminderMinutes:
          this.opts.defaults.defaultReminderMinutes !== undefined && this.opts.defaults.defaultReminderMinutes >= 0
            ? [this.opts.defaults.defaultReminderMinutes]
            : undefined,
      };
    };

    const current = (): QuickAddParse | null => parseQuickAdd(input.value, new Date());

    // 底部:取消(ghost)/ 保存(primary,仅当能解析出非空标题时可用)
    const footer = content.createDiv({ cls: "ag2-editor-footer" });
    footer.createEl("button", { cls: "ag2-btn ag2-btn-ghost", text: t("editor.cancel") })
      .addEventListener("click", () => this.close());
    const saveBtn = footer.createEl("button", { cls: "ag2-btn ag2-btn-primary", text: t("editor.save") });
    saveBtn.disabled = true;

    const save = async (): Promise<void> => {
      const p = current();
      if (!p) return;
      const ev = buildEvent(p);
      await this.opts.onSave(ev);
      new Notice(t("quickadd.saved", { title: ev.title }));
      this.close();
    };

    const refresh = (): void => {
      const p = current();
      if (!p) {
        preview.setText(t("quickadd.hint"));
        preview.removeAttribute("title");
        saveBtn.disabled = true;
        return;
      }
      const parts = [p.dateKey, p.allDay ? t("panel.allDay") : (p.startHHMM ?? "")];
      if (!p.allDay && p.durationMin) parts.push(fmtDuration(p.durationMin));
      preview.setText(parts.filter(Boolean).join(" · "));
      preview.setAttribute("title", p.hits.join(" | "));
      saveBtn.disabled = false;
    };

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", (evt: KeyboardEvent) => {
      // isComposing:中文输入法回车确认候选词时不应触发保存
      if (evt.key === "Enter" && !evt.isComposing && !saveBtn.disabled) {
        evt.preventDefault();
        void save();
      }
    });
    saveBtn.addEventListener("click", () => void save());

    refresh();
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
