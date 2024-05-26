/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// See: https://gjs.guide/extensions/topics/extension.html#extension
import Meta from "gi://Meta";
import Gio from "gi://Gio";

// See: https://gjs.guide/extensions/topics/extension.html#extension
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const WindowState = Object.freeze({
  PLACED: Symbol("place"),
  BACK: Symbol("back"),
  REORDERED: Symbol("reorder") // appears to be a place holder
});

// TODO There appears to be an issue with how windows are rearranged when using static workspaces. They get pushed and they never go back

export default class FullscreenToNewWorkspace extends Extension {

  enable() {
    this._mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
    this.settings = this.getSettings();

    this._handles = [];
    // Trigger new window with maximize size and if the window is maximized
    this._handles.push(global.window_manager.connect('unminimize', (_, act) => { this.window_manager_unminimize(act); }));
    this._handles.push(global.window_manager.connect('size-changed', (_, act) => { this.window_manager_size_changed(act); }));
    // this._handles.push(global.window_manager.connect('switch-workspace', (_) => { this.window_manager_switch_workspace(); }));
    this._handles.push(global.window_manager.connect('minimize', (_, act) => { this.window_manager_minimize(act); }));
    this._handles.push(global.window_manager.connect('map', (_, act) => { this.window_manager_map(act); }));
    this._handles.push(global.window_manager.connect('destroy', (_, act) => { this.window_manager_destroy(act); }));
    this._handles.push(global.window_manager.connect('size-change', (_, act, change, rectold) => { this.window_manager_size_change(act, change, rectold); }));

    this._windowids_maximized = {};
    this._windowids_size_change = {};
  }

  disable() {
    this._mutterSettings = null;
    this.settings = null;

    // remove array and disconnect
    const handles_to_disconnect = this._handles.splice(0);
    handles_to_disconnect.forEach(h => global.window_manager.disconnect(h));

    this._windowids_maximized = {};
    this._windowids_size_change = {};
  }

  /**  
   * 
   * @param {Meta.WorkspaceManager} manager 
   * @param {Number} mMonitor 
   * @returns The first free workspace on the specified monitor
   */
  getFirstFreeMonitor(manager, mMonitor) {
    const n = manager.get_n_workspaces();
    for (let i = 0; i < n; i++) {
      let win_count = manager.get_workspace_by_index(i).list_windows().filter(w => !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor).length;
      if (win_count < 1)
        return i;
    }
    return -1;
  }

  /**
   * 
   * @param {Meta.WorkspaceManager} manager  An instance of the workspace manager
   * @param {Number} nCurrent The index of the active workspace
   * @param {Number} mMonitor The index of the monitor the application is on
   * @returns The index of the last occupied workspace on the specified monitor
   */
  getLastOccupiedMonitor(manager, nCurrent, mMonitor) {
    for (let i = nCurrent - 1; i >= 0; i--) {
      let win_count = manager.get_workspace_by_index(i).list_windows().filter(w => !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor).length;
      if (win_count > 0)
        return i;
    }

    const n = manager.get_n_workspaces();
    for (let i = nCurrent + 1; i < n; i++) {
      let win_count = manager.get_workspace_by_index(i).list_windows().filter(w => !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor).length;
      if (win_count > 0)
        return i;
    }
    return -1;
  }

  /**
   * 
   * @param {Meta.Window} win 
   */
  placeOnWorkspace(win) {
    //global.log("achim","placeOnWorkspace:"+win.get_id());

    // Idea: don't move the coresponding window to an other workspace (it may be not fully active yet)
    // Reorder the workspaces and move all other window

    const mMonitor = win.get_monitor();
    const wList = win.get_workspace().list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor);
    if (wList.length >= 1) {
      const manager = global.get_workspace_manager();
      const current = manager.get_active_workspace_index();
      if (this._mutterSettings.get_boolean('workspaces-only-on-primary') || global.get_display().get_n_monitors() == 1) {
        // Only primary monitor is relevant, others don't have multiple workspaces
        const mPrimary = win.get_display().get_primary_monitor();
        if (mMonitor != mPrimary)
          return;

        // Check for a free monitor: do nothing if doesn't exist
        const firstFree = this.getFirstFreeMonitor(manager, mMonitor);
        if (firstFree == -1)
          return;

        if (current < firstFree) { // This should always be true for dynamic workspaces
          // insert existing window on next monitor (each other workspace is moved one index further)
          manager.reorder_workspace(manager.get_workspace_by_index(firstFree), current);
          // move the other windows to their old places
          wList.forEach(w => { w.change_workspace_by_index(current, false); });

          // remember reordered window
          this._windowids_maximized[win.get_id()] = WindowState.REORDERED;
        }
        else if (current > firstFree) {
          // show window on next free monitor (doesn't happen with dynamic workspaces)
          manager.reorder_workspace(manager.get_workspace_by_index(current), firstFree);
          manager.reorder_workspace(manager.get_workspace_by_index(firstFree + 1), current);

          // move the other windows to their old places
          wList.forEach(w => { w.change_workspace_by_index(current, false); });
          // remember reordered window
          this._windowids_maximized[win.get_id()] = WindowState.REORDERED;
        }
      }
      else {
        // All monitors have workspaces
        // search the workspaces for a free monitor on the same index
        const firstFree = this.getFirstFreeMonitor(manager, mMonitor);
        // No free monitor: do nothing
        if (firstFree == -1)
          return;

        // show the window on the workspace with the empty monitor
        const wListcurrent = win.get_workspace().list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
        const wListfirstfree = manager.get_workspace_by_index(firstFree).list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
        if (current < firstFree) {
          manager.reorder_workspace(manager.get_workspace_by_index(firstFree), current);
          manager.reorder_workspace(manager.get_workspace_by_index(current + 1), firstFree);

          // move the other windows to their old places
          wListcurrent.forEach(w => { w.change_workspace_by_index(current, false); });
          wListfirstfree.forEach(w => { w.change_workspace_by_index(firstFree, false); });

          // remember reordered window
          this._windowids_maximized[win.get_id()] = WindowState.REORDERED;
        }
        else if (current > firstFree) {
          manager.reorder_workspace(manager.get_workspace_by_index(current), firstFree);
          manager.reorder_workspace(manager.get_workspace_by_index(firstFree + 1), current);

          // move the other windows to their old places
          wListcurrent.forEach(w => { w.change_workspace_by_index(current, false); });
          wListfirstfree.forEach(w => { w.change_workspace_by_index(firstFree, false); });

          // remember reordered window
          this._windowids_maximized[win.get_id()] = WindowState.REORDERED;
        }
      }
    }
  }

  /**
   * Move the window back to the last workspace it was in
   * @param {Meta.Window} win 
   * @returns 
   */
  backto(win) {

    //global.log("achim","backto "+win.get_id());

    // Idea: don't move the coresponding window to an other workspace (it may be not fully active yet)
    // Reorder the workspaces and move all other window

    if (!(win.get_id() in this._windowids_maximized)) {
      // no new screen is used in the past: do nothing
      return;
    }

    // this is no longer maximized
    delete this._windowids_maximized[win.get_id()];

    const mMonitor = win.get_monitor();
    const wList = win.get_workspace().list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor);
    if (wList.length == 0) {
      const manager = win.get_display().get_workspace_manager();
      const current = manager.get_active_workspace_index();
      if (this._mutterSettings.get_boolean('workspaces-only-on-primary') || global.get_display().get_n_monitors() == 1) {
        // Only primary monitor is relevant, others don't have multiple workspaces
        const mPrimary = win.get_display().get_primary_monitor();
        if (mMonitor != mPrimary)
          return;

        // No occupied monitor: do nothing
        const lastOccupied = this.getLastOccupiedMonitor(manager, current, mMonitor);
        if (lastOccupied == -1)
          return;

        const wListLastOccupied = manager.get_workspace_by_index(lastOccupied).list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces() && w.get_monitor() == mMonitor);
        // switch workspace position to last with windows and move all windows there
        manager.reorder_workspace(manager.get_workspace_by_index(current), lastOccupied);
        wListLastOccupied.forEach(w => { w.change_workspace_by_index(lastOccupied, false); });
      }
      else {
        const lastOccupied = this.getLastOccupiedMonitor(manager, current, mMonitor);
        // No occupied monitor: do nothing
        if (lastOccupied == -1)
          return;

        const wListCurrent = win.get_workspace().list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
        if (wListCurrent.length > 0)
          return;

        const wListLastOccupied = manager.get_workspace_by_index(lastOccupied).list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
        // switch workspace position to last with windows and move all windows there
        manager.reorder_workspace(manager.get_workspace_by_index(current), lastOccupied);
        wListLastOccupied.forEach(w => { w.change_workspace_by_index(lastOccupied, false); });
      }
    }
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   */
  window_manager_map(act) {
    const win = act.meta_window;
    if (this.shouldPlaceOnNewWorkspaceWin(win)) {
      this.placeOnWorkspace(win);
    }
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   * @returns 
   */
  window_manager_destroy(act) {
    const win = act.meta_window;
    if (!this.isNormalWindow(win)) {
      return;
    }
    this.backto(win);
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   * @param {*} change 
   * @param {*} rectold 
   */
  window_manager_size_change(act, change, rectold) {
    const win = act.meta_window;
    if (this.shouldPlaceOnNewWorkspaceChange(win, change)) {
      this.setToBePlaced(win);
    } else if (this.shouldPlaceBackToOldWorkspaceChange(win, change, rectold)) {
      this.setToBePlacedBack(win);
    }
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   * @returns 
   */
  window_manager_minimize(act) {
    const win = act.meta_window;
    if (!this.isNormalWindow(win)) {
      return;
    }
    this.backto(win);
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   */
  window_manager_unminimize(act) {
    const win = act.meta_window;
    if (this.shouldPlaceOnNewWorkspaceWin(win)) {
      this.placeOnWorkspace(win);
    }
  }

  /**
   * 
   * @param {Meta.WindowActor} act 
   */
  window_manager_size_changed(act) {
    const win = act.meta_window;
    //global.log("achim","window_manager_size_changed "+win.get_id());
    if (win.get_id() in this._windowids_size_change) {
      if (this.isToBePlaced(win)) {
        this.placeOnWorkspace(win);
      } else if (this.isToBePlacedBack(win)) {
        this.backto(win);
      }
      delete this._windowids_size_change[win.get_id()];
    }
  }

  /**
   * @deprecated
   */
  window_manager_switch_workspace() {
    //global.log("achim","window_manager_switch_workspace");
  }

  /**
   * 
   * @param {Meta.Window} win 
   * @returns 
   */
  isNormalWindow(win) {
    return (win.window_type === Meta.WindowType.NORMAL) &&
      !win.is_always_on_all_workspaces();
  }

  /**
   * 
   * @param {Meta.Window} win 
   * @returns 
   */
  shouldPlaceOnNewWorkspaceWin(win) {
    return this.isNormalWindow(win) && (
      this.isMaximizeEnabled() ?
        // This is also true for fullscreen windows as well as maximized windows  
        win.get_maximized() === Meta.MaximizeFlags.BOTH :
        win.fullscreen
    );
  }

  /**
   * 
   * @param {Meta.Window} win 
   * @param {*} change 
   * @returns 
   */
  shouldPlaceOnNewWorkspaceChange(win, change) {
    return this.isNormalWindow(win) && (
      (this.isMaximizeEnabled() &&
        (change === Meta.SizeChange.MAXIMIZE) &&
        (win.get_maximized() === Meta.MaximizeFlags.BOTH)) ||
      (change === Meta.SizeChange.FULLSCREEN)
    );
  }

  /**
   * 
   * @param {Meta.Window} win 
   * @param {*} change 
   * @param {*} rectold 
   * @returns 
   */
  shouldPlaceBackToOldWorkspaceChange(win, change, rectold) {
    const rectmax = win.get_work_area_for_monitor(win.get_monitor());
    return this.isNormalWindow(win) && (
      (this.isMaximizeEnabled() &&
        (change === Meta.SizeChange.UNMAXIMIZE) &&
        // do nothing if it was only partially maximized
        rectmax.equal(rectold)) ||
      ((change === Meta.SizeChange.UNFULLSCREEN) &&
        (this.isMaximizeEnabled() ?
          (win.get_maximized() !== Meta.MaximizeFlags.BOTH) :
          true))
    );
  }

  isMaximizeEnabled() {
    return this.settings.get_boolean("move-window-when-maximized");
  }

  /**
   * 
   * @param {Meta.Window} window 
   * @returns 
   */
  setToBePlaced(window) {
    this._windowids_size_change[window.get_id()] = WindowState.PLACED;
  }

  /**
   * 
   * @param {Meta.Window} window 
   * @returns 
   */
  isToBePlaced(window) {
    return this._windowids_size_change[window.get_id()] == WindowState.PLACED;
  }

  /**
   * 
   * @param {Meta.Window} window 
   * @returns 
   */
  setToBePlacedBack(window) {
    this._windowids_size_change[window.get_id()] = WindowState.BACK;
  }

  /**
   * 
   * @param {Meta.Window} window 
   * @returns 
   */
  isToBePlacedBack(window) {
    return this._windowids_size_change[window.get_id()] == WindowState.BACK;
  }
}
