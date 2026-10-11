// The only bridge between Firn's UI and the main process. Keep it narrow:
// the UI can ask for navigation and tab changes, and listen for state.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { pageRadius } from './frame';
import type { FirnBridge } from './types';

// Subscribes to a channel and returns a function that unsubscribes.
function listen<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge: FirnBridge = {
  platform: process.platform,
  pageRadius: pageRadius(process.platform, process.getSystemVersion()),
  navigate: (input) => ipcRenderer.send('nav:navigate', input),
  command: (command) => ipcRenderer.send('nav:command', command),
  newTab: () => ipcRenderer.send('tabs:new'),
  openUrl: (input) => ipcRenderer.send('tabs:open-url', input),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  expandLookout: () => ipcRenderer.send('lookout:expand'),
  find: (text, forward, newSearch) =>
    ipcRenderer.send('find:search', text, forward, newSearch),
  closeFind: () => ipcRenderer.send('find:close'),
  zoom: (step) => ipcRenderer.send('page:zoom', step),
  answerPermission: (answer) => ipcRenderer.send('permission:answer', answer),
  showSitePermissions: () => ipcRenderer.send('site:menu'),
  makeDefaultBrowser: () => ipcRenderer.send('browser:make-default'),
  openDownload: (id) => ipcRenderer.send('downloads:open', id),
  showDownload: (id) => ipcRenderer.send('downloads:show', id),
  cancelDownload: (id) => ipcRenderer.send('downloads:cancel', id),
  removeDownload: (id) => ipcRenderer.send('downloads:remove', id),
  retryDownload: (id) => ipcRenderer.send('downloads:retry', id),
  allTabs: () => ipcRenderer.invoke('command:tabs'),
  searchHistory: (query) => ipcRenderer.invoke('history:search', query),
  listHistory: (query) => ipcRenderer.invoke('history:list', query),
  removeHistory: (url) => ipcRenderer.send('history:remove', url),
  showClearHistoryMenu: () => ipcRenderer.send('history:clear-menu'),
  onHistoryChanged: (listener) => listen('history:changed', () => listener()),
  listArchive: () => ipcRenderer.invoke('archive:list'),
  restoreArchived: (id) => ipcRenderer.send('archive:restore', id),
  removeArchived: (id) => ipcRenderer.send('archive:remove', id),
  onArchiveChanged: (listener) =>
    listen<unknown>('archive:changed', (tidied) =>
      listener(typeof tidied === 'number' ? tidied : 0),
    ),
  showArchiveMenu: () => ipcRenderer.send('archive:menu'),
  answerSavePassword: (answer) => ipcRenderer.send('password:answer', answer),
  answerDanger: (answer) => ipcRenderer.send('danger:answer', answer),
  finishWelcome: (basecampUrls) =>
    ipcRenderer.send('welcome:finish', basecampUrls),
  listPasswords: () => ipcRenderer.invoke('passwords:list'),
  revealPassword: (id) => ipcRenderer.invoke('passwords:reveal', id),
  copyPassword: (id) => ipcRenderer.send('passwords:copy', id),
  deletePassword: (id) => ipcRenderer.send('passwords:delete', id),
  onPasswordsChanged: (listener) =>
    listen('passwords:changed', () => listener()),
  updateSettings: (changes) => ipcRenderer.send('settings:update', changes),
  chooseDownloadsFolder: () => ipcRenderer.send('settings:downloads-folder'),
  clearSiteData: () => ipcRenderer.send('settings:clear-site-data'),
  resetAllPermissions: () => ipcRenderer.send('settings:reset-permissions'),
  onSettingsState: (listener) => listen('settings:state', listener),
  showFirnMenu: () => ipcRenderer.send('firn:menu'),
  runAction: (action, arg) => ipcRenderer.send('command:run', action, arg),
  resizeSplit: (id, ratio) => ipcRenderer.send('split:resize', id, ratio),
  separateSplit: (tabId) => ipcRenderer.send('split:separate', tabId),
  toggleSidebar: () => ipcRenderer.send('sidebar:toggle'),
  setPeekTyping: (typing) => ipcRenderer.send('peek:typing', typing),
  setPeekHolding: (holding) => ipcRenderer.send('peek:holding', holding),
  lightsAt: (x, y) => ipcRenderer.send('lights:at', x, y),
  setSidebarWidth: (width) => ipcRenderer.send('sidebar:width', width),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  toggleMute: (id) => ipcRenderer.send('tabs:toggle-mute', id),
  togglePlaying: (id) => ipcRenderer.send('tabs:toggle-playing', id),
  dragToSplit: (id, x) => ipcRenderer.send('tabs:drag-to-split', id, x),
  endDragToSplit: (drop) => ipcRenderer.send('tabs:end-drag-to-split', drop),
  carryTab: (carry) => ipcRenderer.send('tabs:carry', carry),
  dragSplitHandle: (x, y) => ipcRenderer.send('split:handle-drag', x, y),
  dropSplitHandle: () => ipcRenderer.send('split:handle-drop'),
  takeOutOfSplit: (tabId) => ipcRenderer.send('split:take-out', tabId),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  moveTab: (id, toIndex, pinned) =>
    ipcRenderer.send('tabs:move', id, toIndex, pinned),
  showTabMenu: (id) => ipcRenderer.send('tabs:menu', id),
  switchSpace: (id) => ipcRenderer.send('spaces:switch', id),
  newSpace: () => ipcRenderer.send('spaces:new'),
  updateSpace: (id, changes) => ipcRenderer.send('spaces:update', id, changes),
  showSpaceMenu: (id) => ipcRenderer.send('spaces:menu', id),
  showSidebarMenu: () => ipcRenderer.send('sidebar:menu'),
  clearTabs: () => ipcRenderer.send('tabs:clear'),
  iconData: (url) => ipcRenderer.invoke('icon:data', url),
  welcomeIcon: (siteUrl) => ipcRenderer.invoke('welcome:icon', siteUrl),
  windowCommand: (command) => ipcRenderer.send('window:command', command),
  showTip: (text, anchor) => ipcRenderer.send('tip:show', text, anchor),
  hideTip: () => ipcRenderer.send('tip:hide'),
  tipSize: (width, height) => ipcRenderer.send('tip:size', width, height),
  onTipState: (listener) => listen('tip:state', listener),
  onCarryState: (listener) => listen('carry:state', listener),
  onSplitHandleState: (listener) => listen('split-handle:state', listener),
  ready: () => ipcRenderer.send('ui:ready'),
  onNavState: (listener) => listen('nav:state', listener),
  onTabsState: (listener) => listen('tabs:state', listener),
  onFocusAddress: (listener) => listen('ui:focus-address', listener),
  onMaximizedChange: (listener) => listen('window:maximized', listener),
  onOverlayState: (listener) => listen('overlay:state', listener),
  onFindResult: (listener) => listen('find:result', listener),
  onDownloadsState: (listener) => listen('downloads:state', listener),
  onTopBarState: (listener) => listen('top-bar:state', listener),
  onSidebarState: (listener) => listen('sidebar:state', listener),
  onFrameState: (listener) => listen('window:frame', listener),
  onSpacesState: (listener) => listen('spaces:state', listener),
  onRenameSpace: (listener) => listen('spaces:rename', listener),
  onPickSpaceIcon: (listener) => listen('spaces:pick-icon', listener),
};

contextBridge.exposeInMainWorld('firn', bridge);
