import { App, PluginSettingTab, Setting, type SettingDefinitionItem, type SettingDefinitionGroup, type SettingGroupItem } from "obsidian";
import { setCategoryColors } from "../ui/palette";
import { t } from "../l10n/strings";
import type MyAgendaPluginV2 from "../main";
import type { Settings } from "./settings";

/** 设置页:同步 / 日历 / 外观 / 日记注入。 */
export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MyAgendaPluginV2) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    // 版本标识:一眼确认 Obsidian 里跑的是哪个构建(排查"改了没生效")
    containerEl.createDiv({ cls: "ag2-version-stamp", text: `MyAgenda · v${this.plugin.manifest.version}` });

    new Setting(containerEl).setName(t("settings.section.sync")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.lang"))
      .addDropdown((d) => {
        d.addOption("auto", "Auto");
        d.addOption("zh", "简体中文");
        d.addOption("en", "English");
        d.setValue(s.lang);
        d.onChange(async (v) => {
          s.lang = v as Settings["lang"];
          await this.plugin.saveSettings();
          this.plugin.applyLanguage();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.provider"))
      .addDropdown((d) => {
        d.addOption("none", t("settings.provider.none"));
        d.addOption("icloud", t("settings.provider.icloud"));
        d.addOption("caldav", t("settings.provider.caldav"));
        d.addOption("ics", t("settings.provider.ics"));
        d.setValue(s.provider);
        d.onChange(async (v) => {
          s.provider = v as Settings["provider"];
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl).setName(t("settings.user")).addText((x) =>
      x.setValue(s.user).onChange(async (v) => {
        s.user = v.trim();
        await this.plugin.saveSettings();
      }),
    );

    const pw = new Setting(containerEl).setName(t("settings.password"));
    pw.addText((x) => {
      x.inputEl.type = "password";
      x.setValue(s.password).onChange(async (v) => {
        s.password = v.trim();
        await this.plugin.saveSettings();
      });
    });

    if (s.provider === "icloud") {
      new Setting(containerEl)
        .setName(t("settings.calendars"))
        .addExtraButton((b) =>
          b.setIcon("search").setTooltip(t("settings.fetchCalendars")).onClick(() => void this.plugin.discover()),
        );
      for (const cal of s.calendars) {
        const row = new Setting(containerEl).setName(cal.name || cal.url).setDesc(cal.url);
        row.addText((x: import("obsidian").TextComponent) =>
          x.setPlaceholder("分类").setValue(cal.category).onChange(async (v) => {
            cal.category = v.trim();
            await this.plugin.saveSettings();
          }),
        );
        row.addToggle((tg) =>
          tg.setValue(cal.enabled).onChange(async (v) => {
            cal.enabled = v;
            await this.plugin.saveSettings();
          }),
        );
        row.addExtraButton((b) =>
          b.setIcon("trash").onClick(async () => {
            s.calendars = s.calendars.filter((x) => x !== cal);
            await this.plugin.saveSettings();
            this.display();
          }),
        );
      }
    }

    if (s.provider === "ics") {
      new Setting(containerEl).setName(t("settings.calUrl")).addText((x) =>
        x.setValue(s.icsUrl).onChange(async (v) => {
          s.icsUrl = v.trim();
          await this.plugin.saveSettings();
        }),
      );
    }

    new Setting(containerEl)
      .setName(t("settings.autoSync"))
      .addDropdown((d) => {
        for (const v of [0, 5, 15, 30, 60]) {
          d.addOption(String(v), v === 0 ? t("settings.autoSync.off") : `${v} min`);
        }
        d.setValue(String(s.autoSyncMinutes));
        d.onChange(async (v) => {
          s.autoSyncMinutes = Number(v);
          await this.plugin.saveSettings();
          this.plugin.restartAutoSync();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.conflictPolicy"))
      .addDropdown((d) => {
        d.addOption("ask", t("settings.conflictPolicy.ask"));
        d.addOption("server", t("settings.conflictPolicy.server"));
        d.setValue(s.conflictPolicy);
        d.onChange(async (v) => {
          s.conflictPolicy = v as Settings["conflictPolicy"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(t("settings.section.appearance")).setHeading();
    {
      const cats = new Set<string>((s.calendars ?? []).filter((c) => c.enabled && c.category.trim()).map((c) => c.category.trim()));
      if (s.defaultCategory.trim()) cats.add(s.defaultCategory.trim());
      for (const [cat, color] of Object.entries(s.categoryColors)) if (color) cats.add(cat);
      for (const cat of [...cats].sort()) {
        new Setting(containerEl)
          .setName(cat)
          .addText((x) => {
            x.setValue(s.categoryColors[cat] ?? "");
            x.inputEl.type = "color";
            x.inputEl.addClass("ag2-colorinput");
            x.onChange(async (v) => {
              if (/^#[0-9a-fA-F]{6}$/.test(v)) { s.categoryColors[cat] = v; } else { delete s.categoryColors[cat]; }
              setCategoryColors(s.categoryColors);
              await this.plugin.saveSettings();
            });
          });
      }
    }
    new Setting(containerEl)
      .setName(t("settings.accent"))
      .addDropdown((d) => {
        d.addOption("ios", t("settings.accent.ios"));
        d.addOption("theme", t("settings.accent.theme"));
        d.addOption("custom", t("settings.accent.custom"));
        d.setValue(["ios", "theme"].includes(s.accent) ? s.accent : "custom");
        d.onChange(async (v) => {
          s.accent = v === "custom" ? "#007aff" : v;
          await this.plugin.saveSettings();
          this.plugin.refreshPanels();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.weekStart"))
      .addDropdown((d) => {
        d.addOption("1", t("settings.weekStart.mon"));
        d.addOption("0", t("settings.weekStart.sun"));
        d.setValue(String(s.weekStart));
        d.onChange(async (v) => {
          s.weekStart = v === "0" ? 0 : 1;
          await this.plugin.saveSettings();
          this.plugin.refreshPanels();
        });
      });

    new Setting(containerEl).setName(t("settings.section.inject")).setHeading();
    new Setting(containerEl)
      .setName(t("cmd.inject"))
      .setDesc(t("inject.openFirst"))
      .addButton((b) => b.setButtonText(t("cmd.inject")).onClick(() => void this.plugin.injectCommand()));
    new Setting(containerEl).setName(t("settings.inject.enable")).addToggle((tg) =>
      tg.setValue(s.injectEnabled).onChange(async (v) => {
        s.injectEnabled = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName(t("settings.inject.marker")).addText((x) =>
      x.setValue(s.injectMarker).onChange(async (v) => {
        s.injectMarker = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName(t("settings.inject.folder")).addText((x) =>
      x.setValue(s.injectFolder).onChange(async (v) => {
        s.injectFolder = v.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName(t("settings.reminders")).addToggle((tg) =>
      tg.setValue(s.remindersEnabled).onChange(async (v) => {
        s.remindersEnabled = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("存储文件夹").addText((x) =>
      x.setValue(s.folder).onChange(async (v) => {
        s.folder = v.trim() || "Agenda";
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName(t("settings.section.defaults")).setHeading();
    new Setting(containerEl).setName(t("settings.defaultCategory")).addText((x) =>
      x.setValue(s.defaultCategory).onChange(async (v) => {
        s.defaultCategory = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName(t("settings.defaultReminder")).addText((x) =>
      x.setValue(String(s.defaultReminderMinutes)).onChange(async (v) => {
        const n = Number.parseInt(v, 10);
        s.defaultReminderMinutes = Number.isFinite(n) ? n : -1;
        await this.plugin.saveSettings();
      }),
    );



    new Setting(containerEl).setName(t("settings.security.note.name")).setDesc(t("settings.security.note.desc"));

    new Setting(containerEl).setName(t("settings.debug.name")).addToggle((tg) =>
      tg.setValue(s.debugLogging).onChange(async (v) => {
        s.debugLogging = v;
        await this.plugin.saveSettings();
      }),
    );
  }

  // —— 1.13+ 声明式设置:注册进设置搜索;1.12 及以下仍走 display()。 ——

  private groupOf(heading: string, items: SettingGroupItem[]): SettingDefinitionGroup {
    return { type: "group", heading, items };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.groupOf(t("settings.section.sync"), [
        { name: t("settings.lang"), control: { type: "dropdown", key: "lang", options: { auto: "Auto", zh: "简体中文", en: "English" } } },
        { name: t("settings.provider"), control: { type: "dropdown", key: "provider", options: { none: t("settings.provider.none"), icloud: t("settings.provider.icloud"), caldav: t("settings.provider.caldav"), ics: t("settings.provider.ics") } } },
        { name: t("settings.user"), control: { type: "text", key: "user" } },
        {
          name: t("settings.password"),
          searchable: false,
          render: (setting: Setting) => {
            setting.setName(t("settings.password"));
            setting.addText((x) => {
              x.inputEl.type = "password";
              x.setValue(this.plugin.settings.password).onChange(async (v) => {
                this.plugin.settings.password = v.trim();
                await this.plugin.saveSettings();
              });
            });
          },
        },
        {
          name: t("settings.calendars"),
          searchable: false,
          visible: () => this.plugin.settings.provider === "icloud",
          render: (setting: Setting) => {
            setting.setName(t("settings.calendars")).setDesc(this.plugin.settings.calendars.map((c) => `${c.enabled ? "☑" : "☐"} ${c.name || c.url}`).join("  ") || t("settings.calUrl"));
            setting.addExtraButton((b) => b.setIcon("search").setTooltip(t("settings.fetchCalendars")).onClick(() => void this.plugin.discover()));
          },
        },
        {
          name: t("settings.calUrl"),
          searchable: false,
          visible: () => this.plugin.settings.provider === "ics",
          control: { type: "text", key: "icsUrl" },
        },
        { name: t("settings.autoSync"), control: { type: "dropdown", key: "autoSyncMinutes", options: Object.fromEntries([0, 5, 15, 30, 60].map((v) => [String(v), v === 0 ? t("settings.autoSync.off") : `${v} min`])) } },
        { name: t("settings.conflictPolicy"), control: { type: "dropdown", key: "conflictPolicy", options: { ask: t("settings.conflictPolicy.ask"), server: t("settings.conflictPolicy.server") } } },
      ]),
      this.groupOf(t("settings.section.appearance"), [
        { name: t("settings.accent"), control: { type: "dropdown", key: "accent", options: { ios: t("settings.accent.ios"), theme: t("settings.accent.theme"), custom: t("settings.accent.custom") } } },
        { name: t("settings.weekStart"), control: { type: "dropdown", key: "weekStart", options: { "1": t("settings.weekStart.mon"), "0": t("settings.weekStart.sun") } } },
      ]),
      this.groupOf(t("settings.section.inject"), [
        {
          name: t("cmd.inject"),
          desc: t("inject.openFirst"),
          searchable: false,
          render: (setting: Setting) => {
            setting.setName(t("cmd.inject")).setDesc(t("inject.openFirst"));
            setting.addButton((b) => b.setButtonText(t("cmd.inject")).onClick(() => void this.plugin.injectCommand()));
          },
        },
        { name: t("settings.inject.enable"), control: { type: "toggle", key: "injectEnabled" } },
        { name: t("settings.inject.marker"), control: { type: "text", key: "injectMarker" } },
        { name: t("settings.inject.folder"), control: { type: "text", key: "injectFolder" } },
        { name: t("settings.reminders"), control: { type: "toggle", key: "remindersEnabled" } },
        { name: "存储文件夹", control: { type: "text", key: "folder" } },
      ]),
      this.groupOf(t("settings.section.defaults"), [
        { name: t("settings.defaultCategory"), control: { type: "text", key: "defaultCategory" } },
        { name: t("settings.defaultReminder"), control: { type: "text", key: "defaultReminderMinutes" } },
        { name: t("settings.security.note.name"), desc: t("settings.security.note.desc") },
        { name: t("settings.debug.name"), control: { type: "toggle", key: "debugLogging" } },
      ]),
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "autoSyncMinutes") return String(s.autoSyncMinutes);
    if (key === "weekStart") return String(s.weekStart);
    if (key === "accent") return ["ios", "theme"].includes(s.accent as string) ? s.accent : "custom";
    return s[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "lang") { s.lang = value as Settings["lang"]; await this.plugin.saveSettings(); this.plugin.applyLanguage(); return; }
    if (key === "autoSyncMinutes") { s.autoSyncMinutes = Number(value); await this.plugin.saveSettings(); this.plugin.restartAutoSync(); return; }
    if (key === "accent") { s.accent = value === "custom" ? "#007aff" : String(value); await this.plugin.saveSettings(); this.plugin.refreshPanels(); return; }
    if (key === "weekStart") { s.weekStart = value === "0" ? 0 : 1; await this.plugin.saveSettings(); this.plugin.refreshPanels(); return; }
    if (key === "folder") { s.folder = String(value).trim() || "Agenda"; await this.plugin.saveSettings(); return; }
    if (key === "defaultReminderMinutes") {
      const n = Number.parseInt(String(value), 10);
      s.defaultReminderMinutes = Number.isFinite(n) ? n : -1;
      await this.plugin.saveSettings();
      return;
    }
    if (key in s) { s[key] = value; await this.plugin.saveSettings(); }
  }
}
