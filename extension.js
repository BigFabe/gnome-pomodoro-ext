import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const Phase = Object.freeze({
    FOCUS: 'focus',
    SHORT_BREAK: 'short-break',
    LONG_BREAK: 'long-break',
});

const MAX_OVERTIME_SECONDS = 10 * 60;
const COLOR_WHITE = Object.freeze([255, 255, 255]);
const COLOR_GREEN = Object.freeze([64, 255, 64]);
const COLOR_YELLOW = Object.freeze([255, 255, 64]);
const COLOR_RED = Object.freeze([255, 64, 64]);

export default class PomodoroTimerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._phase = Phase.FOCUS;
        this._completedFocusSessions = 0;
        this._running = false;
        this._sessionActive = false;
        this._awaitingNextPhase = false;
        this._overtimeStartUsec = 0;
        this._overtimeSeconds = 0;
        this._timeoutId = 0;
        this._tickerTimeoutId = 0;
        this._tickerTaskId = null;
        this._deadlineUsec = 0;
        this._settingsSignalIds = [];
        this._tasks = this._loadTasks();
        this._remainingSeconds = this._durationForPhase(this._phase);

        this._buildIndicator();
        this._connectSettings();
        this._updateUi();

        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        this._refreshTicker();
    }

    disable() {
        this._removeTimeout();
        this._removeTickerTimeout();

        if (this._settings) {
            for (const signalId of this._settingsSignalIds)
                this._settings.disconnect(signalId);
        }

        this._settingsSignalIds = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._timerBox = null;
        this._panelLabel = null;
        this._tickerLabel = null;
        this._phaseLabel = null;
        this._timeLabel = null;
        this._startPauseItem = null;
        this._tasksSection = null;
        this._taskEntry = null;
        this._tasks = null;
        this._settings = null;
    }

    _buildIndicator() {
        // 0.5 richtet die Mitte des Menüs an der Mitte des Panel-Buttons aus.
        this._indicator = new PanelMenu.Button(0.5, 'Pomodoro-Timer');

        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._tickerLabel = new St.Label({
            style_class: 'pomodoro-task-ticker',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._tickerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._tickerLabel);

        this._timerBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timerBox.add_child(new St.Icon({
            icon_name: 'alarm-symbolic',
            style_class: 'system-status-icon',
        }));

        this._panelLabel = new St.Label({
            style_class: 'pomodoro-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timerBox.add_child(this._panelLabel);
        box.add_child(this._timerBox);
        this._indicator.add_child(box);

        // Das Menü bleibt am Timer verankert, während der Ticker seine Breite ändern darf.
        this._indicator.setMenu(new PopupMenu.PopupMenu(
            this._timerBox, 0.5, St.Side.TOP));

        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'pomodoro-header',
        });
        const headerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._phaseLabel = new St.Label({
            style_class: 'pomodoro-phase',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(this._phaseLabel);

        this._timeLabel = new St.Label({
            style_class: 'pomodoro-time',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(this._timeLabel);

        headerItem.add_child(headerBox);
        this._indicator.menu.addMenuItem(headerItem);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._startPauseItem = new PopupMenu.PopupImageMenuItem(
            'Starten', 'media-playback-start-symbolic');
        this._startPauseItem.connect('activate', () => this._toggleRunning());
        this._indicator.menu.addMenuItem(this._startPauseItem);

        const stopItem = new PopupMenu.PopupImageMenuItem(
            'Stoppen und zurücksetzen', 'media-playback-stop-symbolic');
        stopItem.connect('activate', () => this._stop());
        this._indicator.menu.addMenuItem(stopItem);

        const skipItem = new PopupMenu.PopupImageMenuItem(
            'Phase überspringen', 'media-skip-forward-symbolic');
        skipItem.connect('activate', () => this._advancePhase(false));
        this._indicator.menu.addMenuItem(skipItem);

        this._indicator.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem('Aufgaben'));

        this._tasksSection = new PopupMenu.PopupMenuSection();
        this._indicator.menu.addMenuItem(this._tasksSection);
        this._rebuildTaskList();

        const inputItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'pomodoro-task-input-row',
        });
        this._taskEntry = new St.Entry({
            style_class: 'pomodoro-task-entry',
            hint_text: 'Neue Aufgabe …',
            can_focus: true,
            x_expand: true,
        });
        this._taskEntry.clutter_text.connect('activate', () => this._addTask());
        inputItem.add_child(this._taskEntry);
        this._indicator.menu.addMenuItem(inputItem);

        this._indicator.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._taskEntry.clutter_text.grab_key_focus();
                this._taskEntry.clutter_text.set_cursor_position(-1);
            }
        });

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const preferencesItem = new PopupMenu.PopupImageMenuItem(
            'Einstellungen', 'preferences-system-symbolic');
        preferencesItem.connect('activate', () => this.openPreferences());
        this._indicator.menu.addMenuItem(preferencesItem);
    }

    _connectSettings() {
        const durationKeys = [
            ['focus-minutes', Phase.FOCUS],
            ['short-break-minutes', Phase.SHORT_BREAK],
            ['long-break-minutes', Phase.LONG_BREAK],
        ];

        for (const [key, phase] of durationKeys) {
            const signalId = this._settings.connect(`changed::${key}`, () => {
                if (!this._running && this._phase === phase)
                    this._remainingSeconds = this._durationForPhase(this._phase);
                this._updateUi();
            });
            this._settingsSignalIds.push(signalId);
        }

        this._settingsSignalIds.push(this._settings.connect(
            'changed::rounds-before-long-break', () => this._updateUi()));
    }

    _toggleRunning() {
        if (this._running)
            this._pause();
        else
            this._start();
    }

    _start() {
        if (this._running)
            return;

        if (this._awaitingNextPhase) {
            this._clearOvertime();
            this._remainingSeconds = this._durationForPhase(this._phase);
        }

        this._sessionActive = true;
        this._running = true;
        this._deadlineUsec = GLib.get_monotonic_time() + this._remainingSeconds * 1_000_000;
        this._scheduleTimeout();
        this._updateUi();
    }

    _pause() {
        if (!this._running)
            return;

        this._remainingSeconds = Math.max(0, Math.ceil(
            (this._deadlineUsec - GLib.get_monotonic_time()) / 1_000_000));
        this._running = false;
        this._removeTimeout();
        this._updateUi();
    }

    _stop() {
        this._running = false;
        this._sessionActive = false;
        this._clearOvertime();
        this._removeTimeout();
        this._remainingSeconds = this._durationForPhase(this._phase);
        this._clearTasks();
        this._updateUi();
    }

    _scheduleTimeout() {
        this._removeTimeout();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            const difference = this._deadlineUsec - GLib.get_monotonic_time();
            if (difference <= 0) {
                this._timeoutId = 0;
                this._remainingSeconds = 0;
                this._advancePhase(true, this._deadlineUsec);
                return GLib.SOURCE_REMOVE;
            }

            this._remainingSeconds = Math.ceil(difference / 1_000_000);
            this._updateUi();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _removeTimeout() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _beginOvertime(startUsec) {
        if (!this._sessionActive)
            return;

        this._awaitingNextPhase = true;
        this._overtimeStartUsec = startUsec;
        this._overtimeSeconds = Math.max(0, Math.floor(
            (GLib.get_monotonic_time() - startUsec) / 1_000_000));
        this._scheduleOvertimeTimeout();
        this._updateUi();
    }

    _scheduleOvertimeTimeout() {
        this._removeTimeout();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (!this._sessionActive || !this._awaitingNextPhase) {
                this._timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            }

            const overtimeSeconds = Math.max(0, Math.floor(
                (GLib.get_monotonic_time() - this._overtimeStartUsec) / 1_000_000));
            if (overtimeSeconds !== this._overtimeSeconds) {
                this._overtimeSeconds = overtimeSeconds;
                this._updateUi();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _clearOvertime() {
        this._awaitingNextPhase = false;
        this._overtimeStartUsec = 0;
        this._overtimeSeconds = 0;
        this._clearTimerColor();
    }

    _advancePhase(completedNaturally, completedAtUsec = 0) {
        const previousPhase = this._phase;
        const completedSet = previousPhase === Phase.LONG_BREAK;
        this._running = false;
        this._clearOvertime();
        this._removeTimeout();

        if (previousPhase === Phase.FOCUS) {
            this._completedFocusSessions++;
            const rounds = this._settings.get_int('rounds-before-long-break');
            this._phase = this._completedFocusSessions % rounds === 0
                ? Phase.LONG_BREAK
                : Phase.SHORT_BREAK;
        } else {
            this._phase = Phase.FOCUS;
        }

        this._remainingSeconds = this._durationForPhase(this._phase);

        if (completedSet) {
            this._sessionActive = false;
            this._clearTasks();
        }

        if (completedNaturally)
            this._notifyPhaseFinished(previousPhase);

        if (completedSet) {
            this._updateUi();
        } else if (this._settings.get_boolean('auto-start-next')) {
            this._start();
        } else if (completedNaturally) {
            this._beginOvertime(completedAtUsec);
        } else {
            this._updateUi();
        }
    }

    _notifyPhaseFinished(previousPhase) {
        if (!this._settings.get_boolean('show-notifications'))
            return;

        if (previousPhase === Phase.FOCUS) {
            const breakName = this._phase === Phase.LONG_BREAK
                ? 'Die lange Pause ist bereit.'
                : 'Die kurze Pause ist bereit.';
            Main.notify('Pomodoro abgeschlossen', breakName);
        } else if (previousPhase === Phase.LONG_BREAK) {
            Main.notify('Pomodoro-Satz abgeschlossen', 'Alle Phasen sind beendet.');
        } else {
            Main.notify('Pause beendet', 'Zeit für die nächste Fokus-Runde.');
        }
    }

    _loadTasks() {
        try {
            const tasks = JSON.parse(this._settings.get_string('tasks-json'));
            if (!Array.isArray(tasks))
                return [];

            return tasks
                .filter(task => task && typeof task.text === 'string')
                .map(task => ({
                    id: String(task.id),
                    text: task.text.trim(),
                    done: Boolean(task.done),
                }))
                .filter(task => task.text.length > 0);
        } catch (error) {
            console.warn(`Pomodoro: Aufgaben konnten nicht geladen werden: ${error.message}`);
            return [];
        }
    }

    _saveTasks() {
        this._settings.set_string('tasks-json', JSON.stringify(this._tasks));
        this._rebuildTaskList();
        this._refreshTicker();
    }

    _addTask() {
        const text = this._taskEntry.get_text().trim();
        if (!text)
            return;

        this._tasks.push({
            id: `${Date.now()}-${Math.random()}`,
            text: text.slice(0, 160),
            done: false,
        });
        this._taskEntry.set_text('');
        this._saveTasks();
    }

    _toggleTask(taskId) {
        const task = this._tasks.find(item => item.id === taskId);
        if (!task)
            return;

        task.done = !task.done;
        this._saveTasks();
    }

    _clearTasks() {
        if (this._tasks.length === 0)
            return;

        this._tasks = [];
        this._saveTasks();
    }

    _rebuildTaskList() {
        if (!this._tasksSection)
            return;

        this._tasksSection.removeAll();
        if (this._tasks.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('Noch keine Aufgaben', {
                reactive: false,
                can_focus: false,
            });
            emptyItem.label.add_style_class_name('pomodoro-task-empty');
            this._tasksSection.addMenuItem(emptyItem);
            return;
        }

        for (const task of this._tasks) {
            const row = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'pomodoro-task-row',
            });
            const button = new St.Button({
                style_class: `pomodoro-task-button${task.done ? ' completed' : ''}`,
                can_focus: true,
                x_expand: true,
            });
            const content = new St.BoxLayout({x_expand: true});
            content.add_child(new St.Icon({
                icon_name: task.done
                    ? 'checkbox-checked-symbolic'
                    : 'checkbox-symbolic',
                style_class: 'pomodoro-task-check',
                y_align: Clutter.ActorAlign.CENTER,
            }));

            const label = new St.Label({
                text: task.text,
                style_class: 'pomodoro-task-label',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            content.add_child(label);
            button.set_child(content);
            button.connect('clicked', () => this._toggleTask(task.id));
            row.add_child(button);
            this._tasksSection.addMenuItem(row);
        }
    }

    _refreshTicker() {
        this._removeTickerTimeout();
        if (!this._tickerLabel)
            return;

        const openTasks = this._tasks.filter(task => !task.done);
        if (openTasks.length === 0) {
            this._tickerTaskId = null;
            this._tickerLabel.text = '';
            this._tickerLabel.hide();
            return;
        }

        let task = openTasks.find(item => item.id === this._tickerTaskId);
        if (!task) {
            task = openTasks[0];
            this._tickerTaskId = task.id;
        }

        this._tickerLabel.text = task.text;
        this._tickerLabel.show();
        if (openTasks.length > 1)
            this._scheduleTickerRotation();
    }

    _scheduleTickerRotation() {
        const delay = 15 + Math.floor(Math.random() * 21);
        this._tickerTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, delay, () => {
                this._tickerTimeoutId = 0;
                this._rotateTicker();
                return GLib.SOURCE_REMOVE;
            });
    }

    _rotateTicker() {
        const openTasks = this._tasks.filter(task => !task.done);
        if (openTasks.length === 0) {
            this._refreshTicker();
            return;
        }

        const currentIndex = openTasks.findIndex(task => task.id === this._tickerTaskId);
        const nextIndex = (currentIndex + 1) % openTasks.length;
        this._tickerTaskId = openTasks[nextIndex].id;
        this._tickerLabel.text = openTasks[nextIndex].text;

        if (openTasks.length > 1)
            this._scheduleTickerRotation();
    }

    _removeTickerTimeout() {
        if (this._tickerTimeoutId) {
            GLib.Source.remove(this._tickerTimeoutId);
            this._tickerTimeoutId = 0;
        }
    }

    _durationForPhase(phase) {
        let key;
        switch (phase) {
        case Phase.SHORT_BREAK:
            key = 'short-break-minutes';
            break;
        case Phase.LONG_BREAK:
            key = 'long-break-minutes';
            break;
        default:
            key = 'focus-minutes';
            break;
        }

        return this._settings.get_int(key) * 60;
    }

    _phaseDescription() {
        const rounds = this._settings.get_int('rounds-before-long-break');
        if (this._phase === Phase.FOCUS) {
            const currentRound = this._completedFocusSessions % rounds + 1;
            return `Fokus · Runde ${currentRound} von ${rounds}`;
        }
        if (this._phase === Phase.LONG_BREAK)
            return 'Lange Pause';
        return 'Kurze Pause';
    }

    _formatTime(totalSeconds, showMinus = false) {
        const absoluteSeconds = Math.abs(totalSeconds);
        const minutes = Math.floor(absoluteSeconds / 60);
        const seconds = absoluteSeconds % 60;
        const prefix = showMinus ? '-' : '';
        return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    _mixColor(from, to, progress) {
        return from.map((channel, index) => Math.round(
            channel + (to[index] - channel) * progress));
    }

    _setTimerColor(color) {
        const style = `color: rgb(${color.join(', ')});`;
        this._panelLabel.set_style(style);
        this._timeLabel.set_style(style);
    }

    _updateTimerColor(showOvertime) {
        if (showOvertime) {
            const progress = Math.min(
                this._overtimeSeconds / MAX_OVERTIME_SECONDS, 1);
            const color = progress <= 0.5
                ? this._mixColor(COLOR_GREEN, COLOR_YELLOW, progress * 2)
                : this._mixColor(COLOR_YELLOW, COLOR_RED, (progress - 0.5) * 2);
            this._setTimerColor(color);
            return;
        }

        const duration = this._durationForPhase(this._phase);
        const progress = Math.min(Math.max(
            1 - this._remainingSeconds / duration, 0), 1);
        this._setTimerColor(this._mixColor(COLOR_WHITE, COLOR_GREEN, progress));
    }

    _clearTimerColor() {
        this._panelLabel?.set_style(null);
        this._timeLabel?.set_style(null);
    }

    _updateUi() {
        if (!this._panelLabel)
            return;

        const showOvertime = this._sessionActive && this._awaitingNextPhase;
        const time = showOvertime
            ? this._formatTime(this._overtimeSeconds, true)
            : this._formatTime(this._remainingSeconds);
        this._panelLabel.text = time;
        this._phaseLabel.text = this._phaseDescription();
        this._timeLabel.text = time;

        this._updateTimerColor(showOvertime);

        this._startPauseItem.label.text = this._running ? 'Pausieren' : 'Starten';
        this._startPauseItem.setIcon(this._running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic');

        let accessibleState = 'pausiert';
        if (this._running)
            accessibleState = 'läuft';
        else if (showOvertime)
            accessibleState = 'wartet auf den Start der nächsten Phase';
        else if (!this._sessionActive)
            accessibleState = 'inaktiv';
        this._indicator.accessible_name = `Pomodoro, ${this._phaseDescription()}, ${time}, ${accessibleState}`;
    }
}
