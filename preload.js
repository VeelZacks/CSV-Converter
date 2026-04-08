const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    processCsv: (data) => ipcRenderer.invoke('process-csv', data),
    openFilePicker: () => ipcRenderer.invoke('open-file-picker'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectDirectory: () => ipcRenderer.invoke('select-directory')
});