const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');

let mainWindow = null;
const settingsPath = path.join(app.getPath('userData'), 'app-settings.json');

function loadSettings() {
    try {
        if (fsSync.existsSync(settingsPath)) {
            const data = fsSync.readFileSync(settingsPath, 'utf8');
            return { ...getDefaultSettings(), ...JSON.parse(data) };
        }
    } catch (e) { console.error(e); }
    return getDefaultSettings();
}

function getDefaultSettings() {
    return { theme: 'light', saveDirectory: null };
}

function saveSettings(settings) {
    fsSync.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

let appSettings = loadSettings();

// Запуск с анимацией
function createWindow() {
    splashWindow = new BrowserWindow({
        width: 550,
        height: 350,
        icon: path.join(__dirname, 'photo.ico'),
        transparent: true, 
        frame: false,       
        alwaysOnTop: true, 
        resizable: false,
        center: true,
        backgroundColor: '#00000000', 
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    splashWindow.loadFile('splash.html');

    mainWindow = new BrowserWindow({
        width: 900,
        height: 750,
        show: false, 
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.close();
            }
            mainWindow.show();
        }, 2500);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Запуск без анимации
// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 900,
//         height: 750,
//         webPreferences: {
//             nodeIntegration: false,
//             contextIsolation: true,
//             preload: path.join(__dirname, 'preload.js')
//         }
//     });
//     mainWindow.loadFile('index.html');
// }

ipcMain.handle('get-settings', () => appSettings);
ipcMain.handle('save-settings', (event, newSettings) => {
    appSettings = { ...appSettings, ...newSettings };
    saveSettings(appSettings);
    return { success: true };
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-file-picker', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'CSV файлы', extensions: ['csv', 'txt'] } 
        ]
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('process-csv', async (event, { filePath, options }) => {
    try {
        let content = await fs.readFile(filePath, 'utf8');

        if (options.findText && options.findText.length > 0) {
            const escapedSearch = options.findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegExp = new RegExp(escapedSearch, 'g');
            content = content.replace(searchRegExp, options.replaceText || '');
        }

        if (options.removeEmptyQuotes) {
            content = content.replace(/"\s*"/g, '');
        }

        content = content.split('\n').map(line => {
            return line
                .replace(/\s*,\s*/g, ',')  
                .replace(/,+/g, ',')          
                .replace(/^,|,$/g, '')         
                .trim();
        }).filter(line => line.length > 0).join('\n'); 

        const outputDir = appSettings.saveDirectory || path.join(os.homedir(), 'Downloads');
        await fs.mkdir(outputDir, { recursive: true });

        const parsedPath = path.parse(filePath);
        const baseName = `${parsedPath.name}_fixed`;
        const extension = '.csv';
        
        let finalPath = path.join(outputDir, baseName + extension);
        let counter = 1;

        while (fsSync.existsSync(finalPath)) {
            finalPath = path.join(outputDir, `${baseName}(${counter})${extension}`);
            counter++;
        }

        await fs.writeFile(finalPath, content, 'utf8');

        console.log(`Файл успешно сохранен: ${finalPath}`);
        return { success: true, outputPath: finalPath };

    } catch (error) {
        console.error('Ошибка при обработке CSV:', error);
        return { 
            success: false, 
            error: error.message || 'Произошла ошибка при обработке файла' 
        };
    }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });