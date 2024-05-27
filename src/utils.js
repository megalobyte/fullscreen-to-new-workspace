/* utils.js
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


/**
 * 
 * @param {Meta.Window} win 
 * @returns {Boolean} 
 */
export function isOnPrimaryMonitor(win) {
  return win.get_monitor() == global.get_display().get_primary_monitor();
}

/**
 * 
 * @param {Meta.Window} win 
 * @returns {Boolean} 
 */
export function notOnPrimaryMonitor(win) {
  return win.get_monitor() != global.get_display().get_primary_monitor();
}

export function moveItem(array, from, to) {
  // Move the handle to the correct location
  // I don't like how it modifies the array, so it could mess you up if not careful
  array.splice(to, 0,
    array.splice(from, 1)
  )
  return array.flat()
}

export function swapItems(array, itemIndex1, itemIndex2) {
  // Could probably be optimized, but this is simple and matches the implementation 
  // of swapWorkspaces in the main extension, and probably isn't that expensive
  // But hopefully it works...
  // Also, it may go unused...
  array = moveItem(array, itemIndex1, itemIndex2);
  itemIndex2 =  itemIndex2 > itemIndex1 ? --itemIndex2 : ++itemIndex2;
  return moveItem(array, itemIndex2, itemIndex1);
}
