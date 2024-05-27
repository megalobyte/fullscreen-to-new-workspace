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

/** TODOs
 * 1. There appears to be an issue with how windows are rearranged when using static workspaces. They get pushed and they never go back
 * 2. Things get a bit messed up when you start maximizing multiple windows
 * 3. If using fixed workspaces, placing windows back will not work properly if moved back, but windows exist behind it
 *      i.e window in workspace 1. Maximize window in workspace 3. It goes to 2, but then goes to 1 when minimized
 * 4. Edge case: How should it be handled if a user moves a full screen window from the overview?
 *      - I think I will delete it from the list of windows to be moved
 *      - This works pretty well 
 * 5. Edge Case: What if the workspace that the window used to exist in gets deleted?
 * 6. Not handling the workspace signal handlers correctly 
*/

// See: https://gjs.guide/extensions/topics/extension.html#extension
import Meta from "gi://Meta";
import Gio from "gi://Gio";

// See: https://gjs.guide/extensions/topics/extension.html#extension
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import * as Utils from './utils.js'

const WindowState = Object.freeze({
  PLACED: Symbol("place"),
  BACK: Symbol("back"),
  MOVED_FORWARD: Symbol("forward"),
  MOVED_BACKWARD: Symbol("backward")
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

    this._handles.push(global.workspace_manager.connect('workspace-added', (_, index) => { this.trackWindowsAdded(index); }));
    this._handles.push(global.workspace_manager.connect('workspace-removed', (_, index) => { this.removeWorkspaceHandler(index); }));

    this._ws_handles = [];
    for (let i = 0; i < global.workspace_manager.get_n_workspaces(); i++) {
      this.trackWindowsAdded(i);
    }

    this._windowids_maximized = {};
    this._windowids_size_change = {};
  }

  removeWorkspaceHandler(index) {
    // Delete the removed handler, so we don't reference it later when disabling the extension
    let dropped_handle = this._ws_handles.splice(index, 1);
    console.warn(`removing workspace ${index}. Associated handle is ${dropped_handle}`)
    console.warn(`Currently tracking ${this._ws_handles.length} workspaces`)
  }

  trackWindowsAdded(index) {
    console.warn(`Tracking workspace ${index}`)
    // I'm not sure if this is the best method. 
    let workspace = global.workspace_manager.get_workspace_by_index(index);
    // Insert ws handler at same index so we can keep track of it
    this._ws_handles.push(workspace.connect('window-added', (_, win) => { this.untrackMaximizedWindow(win); }));
    console.warn(`New handle ${this._ws_handles[index]} pushed to active signals`)
  }

  untrackMaximizedWindow(win) {
    console.warn("calling untrackMaximizedWindow")
    if (win.get_id() in this._windowids_maximized) {
      console.warn("Remove the window from the list of ones to be reordered")
      delete this._windowids_maximized[win.get_id()];
    }
  }

  disable() {
    this._mutterSettings = null;
    this.settings = null;

    // remove array and disconnect
    const handles_to_disconnect = [this._handles.splice(0), this._ws_handles.splice(0)].flat();
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

    // No other windows are active in workspace. Do nothing.
    if (wList == 0) {
      return
    }

    const manager = global.get_workspace_manager();
    const current = manager.get_active_workspace_index();

    // Check for a free monitor: do nothing if doesn't exist
    const firstFree = this.getFirstFreeMonitor(manager, mMonitor);
    // No free monitor: do nothing
    if (firstFree == -1)
      return;

    if (this._mutterSettings.get_boolean('workspaces-only-on-primary') || global.get_display().get_n_monitors() == 1) {
      // Only primary monitor is relevant, others don't have multiple workspaces
      if (Utils.notOnPrimaryMonitor(win))
        return;


      if (current < firstFree) { // This should always be true for dynamic workspaces
        this.moveWorkspace(firstFree, current);
          wList.forEach(w => { w.change_workspace_by_index(current, false); });

        // remember reordered window
        this._windowids_maximized[win.get_id()] = WindowState.MOVED_FORWARD;
      }
      else if (current > firstFree) {
        // show window on next free monitor (doesn't happen with dynamic workspaces)
        this.swapWorkspaces(current, firstFree);

        // remember reordered window
        this._windowids_maximized[win.get_id()] = WindowState.MOVED_BACKWARD;
      }
      // move the other windows to their old places
      wList.forEach(w => { w.change_workspace_by_index(current, false); });
    }
    else {
      }
      else {
        // All monitors have workspaces
      // All monitors have workspaces

      // show the window on the workspace with the empty monitor
      const wListCurrent = win.get_workspace().list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
      const wListFirstFree = manager.get_workspace_by_index(firstFree).list_windows().filter(w => w !== win && !w.is_always_on_all_workspaces());
      
      this.swapWorkspaces(current, firstFree);
      this._windowids_maximized[win.get_id()] = current < firstFree ? 
      WindowState.MOVED_FORWARD : WindowState.MOVED_BACKWARD;
      
      // move the other windows to their old places
      wListCurrent.forEach(w => { w.change_workspace_by_index(current, false); });
      wListFirstFree.forEach(w => { w.change_workspace_by_index(firstFree, false); });
      
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

    const winMonitor = win.get_monitor();
    const manager = win.get_display().get_workspace_manager();
    const current = manager.get_active_workspace_index();

    // Check for last occupied monitor: do nothing if it does not exist
    const lastOccupied = this.getLastOccupiedMonitor(manager, current, winMonitor);
    if (lastOccupied == -1)
      return;

    // Define the filter to be used that will find valid windows in the workspace
    let windowFilter = w => w !== win && !w.is_always_on_all_workspaces();
    if (this._mutterSettings.get_boolean('workspaces-only-on-primary') || global.get_display().get_n_monitors() == 1) {
      // Check if window is on primary monitor. Do nothing if it isn't
      if (Utils.notOnPrimaryMonitor(win))
        return;

      // Update window filter so that it only checks windows that are on the same monitor as the resized window
      windowFilter = w => w !== win && !w.is_always_on_all_workspaces() && w.get_monitor() == winMonitor;
    }

    // Check for valid windows in the workspace. Do nothing if windows are found
    const wCurrentList = win.get_workspace().list_windows().filter(windowFilter);
    if (wCurrentList.length > 0) {
      return
    }

    // Finally, switch workspace position to last with windows and move all windows there (should only be 1 window, right?)
    let wListLastOccupied = manager.get_workspace_by_index(lastOccupied).list_windows().filter(windowFilter);
    this.moveWorkspace(current, lastOccupied);
    wListLastOccupied.forEach(w => { w.change_workspace_by_index(lastOccupied, false); });
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

  /**  
   * Move workspace from one index, to another.
   * 
   * Dure to my bad coding, it is necessary to use this wrapper function 
   * to make sure that the list of workspace signal handles gets tracked 
   * properly. At least it makes the code slightly easier to read
   * FIXME - perhaps there is an API call that does this more easily
   * 
   * @param {Number} from
   * @param {Number} to 
   */
  moveWorkspace(from, to) {
    let manager = global.get_workspace_manager()
    manager.reorder_workspace(manager.get_workspace_by_index(from), to);
    Utils.moveItem(this._ws_handles, from, to)
  }
  
  /**
   * 
   * @param {Number} winIndex1 
   * @param {Number} winIndex2 
   */
  swapWorkspaces(winIndex1, winIndex2) {
    this.moveWorkspace(winIndex1, winIndex2);
    winIndex2 =  winIndex2 > winIndex1 ? --winIndex2 : ++winIndex2;
    this.moveWorkspace(winIndex2, winIndex1);
  }
}
