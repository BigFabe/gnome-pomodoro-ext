import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PomodoroTimerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(520, 520);

        const page = new Adw.PreferencesPage({
            title: 'Pomodoro',
            icon_name: 'alarm-symbolic',
        });
        window.add(page);

        const timesGroup = new Adw.PreferencesGroup({
            title: 'Zeiten',
            description: 'Dauer der einzelnen Phasen in Minuten',
        });
        page.add(timesGroup);

        this._addSpinRow(settings, timesGroup, {
            key: 'focus-minutes',
            title: 'Fokuszeit',
            subtitle: 'Dauer einer Pomodoro-Runde',
            lower: 1,
            upper: 120,
        });
        this._addSpinRow(settings, timesGroup, {
            key: 'short-break-minutes',
            title: 'Kurze Pause',
            subtitle: 'Pause zwischen zwei Fokus-Runden',
            lower: 1,
            upper: 60,
        });
        this._addSpinRow(settings, timesGroup, {
            key: 'long-break-minutes',
            title: 'Lange Pause',
            subtitle: 'Pause nach einem vollständigen Satz',
            lower: 1,
            upper: 120,
        });

        const roundsGroup = new Adw.PreferencesGroup({
            title: 'Runden',
        });
        page.add(roundsGroup);

        this._addSpinRow(settings, roundsGroup, {
            key: 'rounds-before-long-break',
            title: 'Runden bis zur langen Pause',
            subtitle: 'Anzahl abgeschlossener Fokus-Runden',
            lower: 1,
            upper: 12,
        });

        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Verhalten',
        });
        page.add(behaviorGroup);

        const autoStartRow = new Adw.SwitchRow({
            title: 'Nächste Phase automatisch starten',
            subtitle: 'Startet Folgephasen innerhalb eines Satzes ohne weitere Eingabe',
        });
        settings.bind(
            'auto-start-next',
            autoStartRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(autoStartRow);

        const notificationRow = new Adw.SwitchRow({
            title: 'Benachrichtigungen',
            subtitle: 'Zeigt eine Meldung beim Ende einer Phase',
        });
        settings.bind(
            'show-notifications',
            notificationRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(notificationRow);
    }

    _addSpinRow(settings, group, {key, title, subtitle, lower, upper}) {
        const adjustment = new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int(key),
        });
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment,
            digits: 0,
            numeric: true,
        });
        settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
