const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  convertImage: (options) => ipcRenderer.invoke('convert-image', options),
  openFilePicker: () => ipcRenderer.invoke('open-file-picker'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  validateFiles: (filePaths) => ipcRenderer.invoke('validate-files', filePaths) 
});