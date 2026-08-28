# Pomodoro-Timer für GNOME Shell

Eine kleine GNOME-Shell-Erweiterung für GNOME 48 bis 50.

## Funktionen

- Fokuszeit, kurze und lange Pause frei konfigurierbar
- Anzahl der Fokus-Runden bis zur langen Pause konfigurierbar
- Starten, pausieren, stoppen/zurücksetzen und überspringen
- Optionaler automatischer Start der nächsten Phase innerhalb eines Satzes
- Überziehungsanzeige nach Phasenende (`-00:01`, `-00:02`, …) bis zum Start der Folgephase
- Gesamter Panel-Indikator mit Farbverlauf von Weiß am Phasenstart zu Grün bei `00:00`, danach nahtlos bis maximal Rot bei `-10:00`
- Automatischer Stopp nach Ende der langen Pause bzw. des vollständigen Satzes
- Optionale Desktop-Benachrichtigungen
- Aufgabenliste mit Abhaken und dauerhafter Speicherung
- Zufällig wechselnder Ticker für offene Aufgaben im Panel
- Automatisches Löschen der Aufgaben beim Reset oder nach der langen Pause
- Verbleibende Zeit direkt im oberen Panel

## Installation

```bash
cd ~/pomodoro-timer-extension
./install.sh
```

Falls GNOME die Erweiterung in der laufenden Wayland-Sitzung noch nicht erkennt, einmal ab- und wieder anmelden und anschließend ausführen:

```bash
gnome-extensions enable pomodoro-timer@local
```

Die Einstellungen lassen sich über das Menü des Timers oder mit folgendem Befehl öffnen:

```bash
gnome-extensions prefs pomodoro-timer@local
```

## Entwicklung

Nach Änderungen einfach `./install.sh` erneut ausführen. Unter Wayland muss GNOME Shell gegebenenfalls durch Ab- und Anmelden neu geladen werden. Protokolle sind mit folgendem Befehl sichtbar:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```
