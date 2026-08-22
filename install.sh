#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
UUID='pomodoro-timer@local'
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

rm -rf -- "$DEST"
mkdir -p -- "$DEST/schemas"
install -m 0644 "$ROOT/extension.js" "$ROOT/prefs.js" "$ROOT/metadata.json" \
    "$ROOT/stylesheet.css" "$DEST/"
install -m 0644 "$ROOT/schemas/org.gnome.shell.extensions.pomodoro-timer.gschema.xml" \
    "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas"

echo "Installiert nach: $DEST"
if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo 'Die Erweiterung wurde aktiviert.'
else
    echo 'GNOME kennt die neu installierte Erweiterung noch nicht.'
    echo 'Unter Wayland bitte einmal ab- und wieder anmelden und danach ausführen:'
    echo "  gnome-extensions enable '$UUID'"
fi
