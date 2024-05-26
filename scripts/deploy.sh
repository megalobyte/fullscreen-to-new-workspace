#!/bin/sh

NAME=fullscreen-to-empty-workspace@aiono.dev
DIR=src

gnome-extensions disable $NAME

rm -rf ~/.local/share/gnome-shell/extensions/$NAME
cp -r src ~/.local/share/gnome-shell/extensions/$NAME

gnome-extensions enable $NAME