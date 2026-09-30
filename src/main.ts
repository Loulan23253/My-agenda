import { Plugin, Notice, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import { setLang, t } from "./l10n/strings";
import { sanitize, type Settings } from "./kernel/settings";
import { SettingsTab } from "./kernel/settings-tab";
import { VaultFileIO } from "./platform/io";
import { MonthlyNoteStore, monthOf } from "./data/note-store";
import { EMPTY_JOURNAL, type SyncJournal } from "./data/journal";
import type { KeyValueFileIO } from "./data/io";
import { obsidianHttp, discoverCalendars } from "./sync/dav";
import { SyncEngine, type CalendarRoute } from "./sync/engine";
import { parseIcsToEvents } from "./sync/ical";
import { buildIcs } from "./core/ics-export";
import { expandOccurrences, type Occurrence } from "./core/occurrences";
import { parseLocal as parseLocalDate } from "./kernel/dates";
import { AgendaPanelView, PANEL_VIEW_TYPE, type SyncStatus } from "./ui/panel";
import {  askConflict, openSyncHistory, askChoice, openEventEditor , openDiscoverModal } from "./ui/modals";
import { QuickAddModal } from "./ui/quick-add-modal";
import { applyInjection, buildInjectList } from "./ui/inject";
import { dueReminders } from "./kernel/reminders";
import { stripLegacyFromDaily, stripLegacyFromMonthly } from "./data/legacy-clean";
import { planRecurringMove, type RecurMovePick } from "./core/recurrence-move";
import { setCategoryColors } from "./ui/palette";
import { dateKey, startOfDay, addDays, parseLocal } from "./kernel/dates";
import { rebaseRuleOnMove } from "./core/recurrence-rebase";
import { shiftIsoDays } from "./kernel/dates";
import type { CalendarEvent } from "./model/event";


export default class MyAgendaPluginV2 extends Plugin {
  settings!: Settings;
  private io!: KeyValueFileIO;
  private notes!: MonthlyNoteStore;
  private journal: SyncJournal = EMPTY_JOURNAL;
  private cache: { events: CalendarEvent[] } | null = null;
  private syncInFlight = false;
  private syncState: SyncStatus = "idle";
  private firedReminders = new Set<string>();
  private autoSyncTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = sanitize(await this.loadData());
    this.io = new VaultFileIO(this.app.vault, this.app.fileManager);
    this.notes = new MonthlyNoteStore(this.io, this.settings.folder);
    await this.loadJournal();
    setLang(this.resolveLang());
    setCategoryColors(this.settings.categoryColors);
    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerView(PANEL_VIEW_TYPE, (leaf: WorkspaceLeaf) =>
      new AgendaPanelView(leaf, {
        loadEvents: () => this.loadEvents(),
        settings: () => this.settings,
        syncNow: () => void this.syncNow(),
        syncStatus: () => this.syncState,
        saveEvents: (events) => this.saveEventsList(events),
        onMove: (occ: Occurrence, startsAt: string, endsAt: string) =>
          void this.onMoveEvent(occ, startsAt, endsAt),
        onMoveToDay: (occ: Occurrence, toDay: Date) => void this.onMoveToDay(occ, toDay),
        openEditor: (existing, defaultDate, defaultStartHHMM) =>
          openEventEditor(
            this.app,
            existing,
            defaultDate,
            (ev) => this.saveEventsList([ev]),
            existing
              ? (ev) => this.deleteEvent(ev)
              : undefined,
            { defaultCategory: this.settings.defaultCategory, defaultReminderMinutes: this.settings.defaultReminderMinutes, categories: this.enabledCalendarCategories() },
            defaultStartHHMM,
          ),
        pendingLocal: () => this.pendingLocalCount(),
        provider: () => this.settings.provider,
        today: () => new Date(),
      }),
    );

    this.addRibbonIcon("calendar-days", t("cmd.openPanel"), () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: t("cmd.openPanel"), callback: () => void this.openPanel() });
    this.addCommand({ id: "sync-now", name: t("cmd.sync"), callback: () => void this.syncNow() });
    this.addCommand({ id: "inject-daily", name: t("cmd.inject"), callback: () => void this.injectCommand() });
    this.addCommand({
      id: "quick-add",
      name: t("cmd.quickAdd"),
      callback: () =>
        new QuickAddModal(this.app, {
          onSave: (ev) => void this.saveEventsList([ev]),
          defaults: { defaultCategory: this.settings.defaultCategory, defaultReminderMinutes: this.settings.defaultReminderMinutes, categories: this.enabledCalendarCategories() },
        }).open(),
    });

    this.registerEvent(this.app.vault.on("create", (f) => void this.onFileCreate(f)));
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.touchCache(f.path)),
    );
    this.registerEvent(this.app.vault.on("delete", (f) => this.touchCache(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { this.touchCache(f.path); this.touchCache(old); }));

    this.register(() => this.stopAutoSync());
    this.restartAutoSync();
    this.registerInterval(window.setInterval(() => void this.checkReminders(), 30_000));
    this.app.workspace.onLayoutReady(() => { this.startReminderPolling(); void this.catchUpInjection(); });
  }

  private resolveLang(): "zh" | "en" {
    if (this.settings.lang !== "auto") return this.settings.lang;
    // 系统语言探测:navigator.language 在弹窗窗口同样可用(不依赖 localStorage/getLanguage)
    const locale = navigator.language.toLowerCase();
    return locale.startsWith("zh") ? "zh" : "en";
  }

  private touchCache(path: string): void {
    if (path === this.settings.folder || path.startsWith(this.settings.folder + "/")) this.cache = null;
  }

  private journalPath(): string {
    return `${this.settings.folder}/.myagenda/journal.json`;
  }

  private async loadJournal(): Promise<void> {
    const text = await this.io.readText(this.journalPath());
    if (!text) {
      this.journal = { ...EMPTY_JOURNAL, events: {}, calendars: {} };
      return;
    }
    try {
      const parsed = JSON.parse(text) as SyncJournal;
      this.journal = parsed?.version === 2 && parsed.events ? parsed : { ...EMPTY_JOURNAL, events: {}, calendars: {} };
    } catch {
      this.journal = { ...EMPTY_JOURNAL, events: {}, calendars: {} };
    }
  }

  private async saveJournal(): Promise<void> {
    await this.io.writeText(this.journalPath(), JSON.stringify(this.journal, null, 2));
  }

  private loadEvents(): Promise<CalendarEvent[]> {
    // 记忆化:v1 的教训——切视图不该每轮全量读盘;失效由文件事件/写入/同步驱动
    if (this.cache) return Promise.resolve(this.cache.events);
    return this.notes.loadAll().then((r) => {
      this.cache = { events: r.events };
      if (r.skipped > 0) new Notice(`${r.skipped} 个日程块无法解析,已跳过`);
      return r.events;
    });
  }

  private invalidate(): void {
    this.cache = null;
  }

  private async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE);
    if (existing.length) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private routes(): CalendarRoute[] {
    if (this.settings.provider !== "icloud" && this.settings.provider !== "caldav") return [];
    const auth = { user: this.settings.user, pass: this.settings.password };
    if (!auth.user || !auth.pass) return [];
    return this.settings.calendars
      .filter((c) => c.enabled && c.url)
      .map((c) => ({ id: c.id, url: c.url, name: c.name, category: c.category, auth }));
  }

  private async syncNow(manual = true): Promise<void> {
    if (this.syncInFlight) {
      new Notice(t("notice.syncRunning"));
      return;
    }
    const routes = this.routes();
    const isIcs = this.settings.provider === "ics" && this.settings.icsUrl;
    if (this.settings.provider === "none" || (!routes.length && !isIcs)) {
      new Notice(routes.length === 0 && !isIcs ? t("notice.noProvider") : t("notice.incomplete"));
      return;
    }
    this.syncInFlight = true;
    this.syncState = "busy";
    this.refreshPanels();
    try {
      if (isIcs) {
        const res = await obsidianHttp({ url: this.settings.icsUrl, method: "GET" });
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        const events = parseIcsToEvents(res.text, "ics");
        await this.writeAll(events);
        this.syncState = "ok";
      } else {
        const engine = new SyncEngine({
          http: obsidianHttp,
          routes,
          notes: this.notes,
          journal: this.journal,
          saveJournal: () => this.saveJournal(),
          // 冲突裁决:仅"手动同步 + 策略为询问"时弹窗;自动同步/静默策略一律服务器赢
          askConflict: async (info) =>
            manual && this.settings.conflictPolicy === "ask"
              ? askConflict(this.app, info)
              : "theirs",
          notify: (m) => new Notice(m, 10000),
          sleep,
        });
        const summary = await withNetworkRetry(() => engine.run());
        void summary;
        this.syncState = "ok";
      }
      this.settings.lastSync = { at: new Date().toISOString(), ok: true };
      this.pushSyncHistory(true, "");
    } catch (e) {
      this.syncState = "fail";
      this.settings.lastSync = { at: new Date().toISOString(), ok: false };
      const msg = e instanceof Error ? e.message : String(e);
      this.pushSyncHistory(false, msg);
      new Notice(t("notice.syncFail", { msg }), 10000);
    } finally {
      this.syncInFlight = false;
      await this.saveSettings();
      this.invalidate();
      this.refreshPanels();
      void this.checkReminders();
      if (this.syncState === "ok") void this.refreshTodayInjection();
    }
  }

  /** 全量重写月度文件(ICS 导入等无账本路径使用)。 */
  private async writeAll(events: Awaited<ReturnType<MonthlyNoteStore["loadAll"]>>["events"]): Promise<void> {
    // ICS 订阅 = 数据源:该月内容以订阅为准,但保留与订阅无关的既有本地日程
    const existing = (await this.notes.loadAll()).events;
    const importedIds = new Set(events.map((e) => e.id));
    const merged = [...existing.filter((e) => !importedIds.has(e.id)), ...events];
    const months = new Set(merged.map((e) => monthOf(e.startsAt)));
    for (const m of months) {
      const preamble = await this.notes.readMonthPreamble(m);
      await this.notes.writeMonth(m, merged.filter((e) => monthOf(e.startsAt) === m), preamble);
    }
  }

  /** 保存一批日程(新建/编辑/重复实例拆分),写月度文件 + 账本置脏 + 触发同步。 */
  private async saveEventsList(events: CalendarEvent[]): Promise<void> {
    const all = (await this.notes.loadAll()).events;
    const oldById = new Map(all.map((e) => [e.id, e]));
    const merged = [...all];
    for (const ev of events) {
      const idx = merged.findIndex((x) => x.id === ev.id);
      if (idx >= 0) merged[idx] = ev;
      else merged.push(ev);
      const entry = this.journal.events[ev.id];
      if (entry) entry.pushedFingerprint = "dirty";
    }
    // 受影响月份:新位置 + 被移走事件的旧位置(跨月移动不留残留)
    const affected = new Set<string>();
    for (const ev of events) {
      affected.add(monthOf(ev.startsAt));
      const old = oldById.get(ev.id);
      if (old) affected.add(monthOf(old.startsAt));
    }
    for (const month of affected) {
      const preamble = await this.notes.readMonthPreamble(month);
      await this.notes.writeMonth(month, merged, preamble);
    }
    this.invalidate();
    this.refreshPanels();
    void this.syncNow();
  }

  /** 启用日历的分类名(去重,按日历顺序)。 */
  private enabledCalendarCategories(): string[] {
    const out: string[] = [];
    for (const c of this.settings.calendars) {
      if (!c.enabled || !c.category.trim()) continue;
      if (!out.includes(c.category.trim())) out.push(c.category.trim());
    }
    return out;
  }

  /** 拖拽/调整提交:普通事件直接改起止;重复事件按 Apple 语义拆实例,绝不静默改锚点。 */
  private async onMoveEvent(occ: Occurrence, startsAt: string, endsAt: string): Promise<void> {
    const current = (await this.loadEvents()).find((e) => e.id === occ.event.id);
    if (!current) return;
    if (current.repeats?.rule) {
      const occDay = dateKey(parseLocal(occ.start));
      const anchorDay = dateKey(parseLocal(current.startsAt));
      // 拖后续实例 → 只动该实例(原日期 EXDATE + 新位置单次例外),锚点不动;
      // 拖的是锚点实例 → 询问"整个系列 / 仅此实例"
      const pick = occDay === anchorDay
        ? await askChoice(this.app, t("recurrence.choice"), [
            { label: t("recurrence.series"), value: "series" },
            { label: t("recurrence.single"), value: "single" },
          ])
        : "single";
      if (!pick) return;
      await this.saveEventsList(planRecurringMove(current, occ.start, startsAt, endsAt, pick as RecurMovePick));
      return;
    }
    await this.saveEventsList([{ ...current, startsAt, endsAt, isAllDay: current.isAllDay }]);
  }

  /** 月视图拖拽:把日程移到目标日期(按天平移,保持时刻);重复事件按策略处理。 */
  private async onMoveToDay(occ: Occurrence, toDay: Date): Promise<void> {
    const fromDay = dateKey(parseLocalDate(occ.start));
    const toKey = dateKey(toDay);
    if (fromDay === toKey) return;
    const delta = Math.round((parseLocal(toKey).getTime() - parseLocal(fromDay).getTime()) / 86400000);
    const current = (await this.loadEvents()).find((e) => e.id === occ.event.id);
    if (!current) return;
    if (current.repeats?.rule) {
      const pick = await askChoice(this.app, t("recurrence.choice"), [
        { label: t("recurrence.series"), value: "series" },
        { label: t("recurrence.single"), value: "single" },
      ]);
      if (pick === "series") {
        const newStart = shiftIsoDays(current.startsAt, delta);
        const shifted: CalendarEvent = {
          ...current,
          startsAt: newStart,
          endsAt: current.endsAt ? shiftIsoDays(current.endsAt, delta) : undefined,
          repeats: { rule: rebaseRuleOnMove(current.repeats.rule, parseLocal(newStart)) },
        };
        await this.saveEventsList([shifted]);
      } else {
        // 仅此实例:原实例 EXDATE 排除,目标日新建同内容单次日程
        const master: CalendarEvent = {
          ...current,
          skippedDates: [...new Set([...(current.skippedDates ?? []), fromDay])],
        };
        const override: CalendarEvent = {
          ...current,
          id: crypto.randomUUID() + "@myagenda",
          repeats: undefined,
          skippedDates: undefined,
          startsAt: shiftIsoDays(occ.start, delta),
          endsAt: occ.end ? shiftIsoDays(occ.end, delta) : undefined,
        };
        await this.saveEventsList([master, override]);
      }
      return;
    }
    const shifted: CalendarEvent = {
      ...current,
      startsAt: shiftIsoDays(current.startsAt, delta),
      endsAt: current.endsAt ? shiftIsoDays(current.endsAt, delta) : undefined,
    };
    await this.saveEventsList([shifted]);
  }

  /** 删除日程:本地块移除 + 账本条目移除,同步时传播到服务器。 */
  private async deleteEvent(ev: CalendarEvent): Promise<void> {
    await this.notes.removeByUids(new Set([ev.id]));
    // 账本保留条目并置为待删:下轮同步据此删除服务器副本(若直接移除条目,远端会被当成新增而复活)
    const entry = this.journal.events[ev.id];
    if (entry) entry.state = "pendingDelete";
    await this.saveJournal();
    this.invalidate();
    this.refreshPanels();
    void this.syncNow();
  }

  /** 本地未同步日程数:状态非 synced,或推送指纹已置脏的账本条目。 */
  private pendingLocalCount(): number {
    let n = 0;
    for (const entry of Object.values(this.journal.events)) {
      if (entry.state !== "synced" || entry.pushedFingerprint === "dirty") n++;
    }
    return n;
  }




  async discover(): Promise<void> {
    try {
      if (!this.settings.user || !this.settings.password) {
        new Notice(t("notice.needCreds"), 10000);
        return;
      }
      const { calendars, root } = await discoverCalendars(obsidianHttp, {
        user: this.settings.user,
        pass: this.settings.password,
      });
      openDiscoverModal(this.app, calendars, new Set(this.settings.calendars.map((x) => x.url)), (picked) => {
        for (const c of picked) {
          this.settings.calendars.push({ id: c.id, url: c.url, name: c.name, category: c.name, enabled: true });
        }
        void this.saveSettings().then(() => {
          new Notice(`[${root}] ` + t("notice.discoverDone", { n: picked.length }), 10000);
          this.refreshPanels();
        });
      });
    } catch (e) {
      new Notice(t("notice.discoverFail", { msg: e instanceof Error ? e.message : String(e) }), 10000);
    }
  }


  async exportIcs(): Promise<void> {
    try {
      const events = await this.loadEvents();
      if (events.length === 0) {
        new Notice(t("notice.exportEmpty"));
        return;
      }
      const path = `${this.settings.folder}/myagenda-export-${dateKey(new Date()).replace(/-/g, "")}.ics`;
      await this.io.writeText(path, buildIcs(events));
      new Notice(t("notice.exportDone", { n: events.length, path }), 10000);
    } catch (e) {
      new Notice(t("notice.exportError", { msg: e instanceof Error ? e.message : String(e) }), 10000);
    }
  }

  async migrateToClean(): Promise<void> {
    const months = new Set((await this.notes.listMonthPaths()).map((p) => p.slice(-10, -3)));
    let n = 0;
    const all = (await this.notes.loadAll()).events;
    const byMonth = new Map<string, typeof all>();
    for (const ev of all) {
      const m = monthOf(ev.startsAt);
      const list = byMonth.get(m) ?? [];
      list.push(ev);
      byMonth.set(m, list);
    }
    for (const month of months) {
      const preamble = await this.notes.readMonthPreamble(month);
      const evs = byMonth.get(month) ?? [];
      await this.notes.writeMonth(month, evs, preamble);
      n++;
    }
    this.invalidate();
    new Notice(t("notice.migrateDone", { n }));
  }

  /** injectFolder 作用域:设置了前缀就只匹配其下(空 = 全库)。 */
  private inInjectScope(path: string): boolean {
    const folder = this.settings.injectFolder.trim().replace(/^\/|\/$/g, "");
    return folder === "" || path === folder || path.startsWith(folder + "/");
  }

  /** 同步成功后刷新今日注入:仅当注入块已存在(用户删了块就尊重),重建并保留勾选状态 */
  private async refreshTodayInjection(): Promise<void> {
    if (!this.settings.injectEnabled) return;
    const name = dateKey(new Date()) + ".md";
    const found = this.app.vault.getMarkdownFiles().find((f) => f.name === name && this.inInjectScope(f.path));
    if (!found) return;
    try {
      if (!(await this.app.vault.cachedRead(found)).includes("<!--ag2-injected-->")) return;
      await this.injectIntoFile(found, true);
    } catch (e) {
      console.error("[myagenda-v2] injection refresh skipped", e);
    }
  }

  /** 启动兜底:日记在插件加载前已建(创建事件已错过)→ 主动补注入(已有注入块则跳过) */
  private async catchUpInjection(): Promise<void> {
    if (!this.settings.injectEnabled) return;
    const name = dateKey(new Date()) + ".md";
    const found = this.app.vault.getMarkdownFiles().find((f) => f.name === name && this.inInjectScope(f.path));
    if (!found) return;
    try {
      const content = await this.app.vault.cachedRead(found);
      if (!content.includes(this.settings.injectMarker)) return;
      await this.injectIntoFile(found, false);
    } catch (e) {
      console.error("[myagenda-v2] injection catch-up skipped", e);
    }
  }

  private pushSyncHistory(ok: boolean, msg: string): void {
    const entry = { at: new Date().toISOString(), ok, msg: msg || undefined };
    this.settings.syncHistory = [entry, ...this.settings.syncHistory].slice(0, 10);
  }

  /** 强制全量同步:丢弃增量游标,下轮扫描回退全量 REPORT。 */
  private async forceFullResync(): Promise<void> {
    for (const id of Object.keys(this.journal.calendars)) delete this.journal.calendars[id];
    await this.saveJournal();
    await this.syncNow();
  }

  private openSyncHistoryModal(): void {
    openSyncHistory(this.app, this.settings.syncHistory, () => void this.forceFullResync());
  }

  /** 清理 v1 残留:日记里的 agenda-injected 注入块 + 月度文件里的 v1 遗留字段行。 */
  async cleanupLegacy(): Promise<void> {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f.name)) {
        await this.app.vault.process(f, (text) => {
          const [next, c] = stripLegacyFromDaily(text);
          n += c;
          return next;
        });
      } else if (f.path.startsWith(this.settings.folder + "/") && /\d{4}-\d{2}\.md$/.test(f.name)) {
        await this.app.vault.process(f, (text) => {
          const [next, c] = stripLegacyFromMonthly(text);
          n += c;
          return next;
        });
      }
    }
    this.invalidate();
    new Notice(n > 0 ? t("cleanup.done", { n }) : t("cleanup.none"));
  }

  async injectCommand(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("inject.openFirst"));
      return;
    }
    const r = await this.injectIntoFile(file, true);
    if (r.status === "injected") new Notice(t("inject.done", { n: r.count ?? 0 }));
  }

  private async onFileCreate(file: TAbstractFile): Promise<void> {
    if (!this.settings.injectEnabled) return;
    if (!(file instanceof TFile) || file.extension !== "md" || !/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) return;
    if (!this.inInjectScope(file.path)) return;
    let found = false;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      await sleep(250 * (attempt + 1));
      try {
        const content = await this.app.vault.read(file);
        if (content.includes(this.settings.injectMarker)) found = true;
      } catch {
        return;
      }
    }
    if (!found) return;
    try {
      await this.injectIntoFile(file, false);
    } catch (e) {
      console.error("[myagenda-v2] injection skipped", e);
    }
  }

  private async injectIntoFile(file: TFile, force: boolean): Promise<{ status: string; count?: number; date?: string }> {
    const dm = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dm) return { status: "not-diary", date: file.name };
    if (!this.inInjectScope(file.path)) return { status: "outside-folder", date: dm[1] };
    const date = dm[1];
    const [y, mo, d] = date.split("-").map(Number);
    const day = new Date(y, mo - 1, d);
    const events = await this.loadEvents();
    const occs: Occurrence[] = expandOccurrences(events, startOfDay(day), addDays(startOfDay(day), 1));
    const items = buildInjectList(occs);
    let status: string = "no-marker";
    let injectedCount: number | undefined;
    await this.app.vault.process(file, (content) => {
      const r = applyInjection(content, {
        marker: this.settings.injectMarker,
        items,
        force,
        preserveChecked: true,
        format: {
          checkbox: this.settings.injectUseCheckbox,
          place: this.settings.injectShowPlace,
          category: this.settings.injectShowCategory,
          prefix: this.settings.injectPrefix,
          timeFormat: this.settings.injectTimeFormat,
        },
      });
      status = r.status;
      injectedCount = r.count;
      return r.content;
    });
    return { status, count: injectedCount, date };
  }

  private reminderTimer: number | null = null;

  private startReminderPolling(): void {
    if (this.reminderTimer !== null) return;
    this.reminderTimer = window.setInterval(() => void this.checkReminders(), 60_000);
    void this.checkReminders();
  }

  /** 提醒:每分钟轮询,只发"刚到点"的(2 分钟回溯容忍),绝不提前、过点太久不补发。 */
  private async checkReminders(): Promise<void> {
    if (!this.settings.remindersEnabled) return;
    const events = await this.loadEvents();
    for (const due of dueReminders(events, new Date())) {
      const key = `${due.id}|${due.dueIso}`;
      if (this.firedReminders.has(key)) continue;
      if (this.firedReminders.size > 500) this.firedReminders.clear();
      this.firedReminders.add(key);
      new Notice(`⏰ ${due.title} · ${due.dueIso.slice(11, 16)}`, 10000);
    }
  }

  applyLanguage(): void {
    setLang(this.resolveLang());
    setCategoryColors(this.settings.categoryColors);
    this.refreshPanels();
  }

  refreshPanels(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE)) {
      (leaf.view as { rerender?: () => void }).rerender?.();
    }
  }

  restartAutoSync(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
    const minutes = this.settings.autoSyncMinutes;
    if (!minutes) return;
    this.autoSyncTimer = window.setInterval(() => {
      if (this.syncInFlight) return;
      void this.syncNow(false);
    }, minutes * 60_000);
  }
  private stopAutoSync(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
  async saveData(data: unknown): Promise<void> {
    // 交给 Obsidian 的 data.json 通道
    await super.saveData(data);
  }
  onunload(): void {
    this.stopAutoSync();
    if (this.reminderTimer !== null) {
      window.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

const NETWORK_RE = /超时|timeout|ECONN|network|failed to fetch|fetch failed|ENOTFOUND|ERR_/i;

/** 网络类错误自动重试(1s/3s),其他错误直接抛出。 */
async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const m = e instanceof Error ? e.message : String(e);
      if (attempt >= 2 || !NETWORK_RE.test(m)) throw e;
      await sleep([1000, 3000][attempt]);
    }
  }
  throw last;
}
