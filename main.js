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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 750,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile('index.html');
}

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
        let rawContent = await fs.readFile(filePath, 'utf8');

        let lines = rawContent.split(/\r?\n/);

        let processedLines = lines.map((line, index) => {
            let currentLine = line;

            if (!currentLine.trim()) return null;

            if (options.replacements && Array.isArray(options.replacements)) {
                options.replacements.forEach(rule => {
                    if (rule.find) {
                        const escapedSearch = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const searchRegExp = new RegExp(escapedSearch, 'g');
                        currentLine = currentLine.replace(searchRegExp, rule.replace || '');
                    }
                });
            }

            if (options.removeEmptyQuotes) {
                currentLine = currentLine.replace(/"\s*"/g, '');
            }

            let cells = currentLine.split(',').map(cell => cell.trim());

            while (cells.length > 0 && cells[cells.length - 1] === "") {
                cells.pop();
            }

            return cells.join(',');
        });

        if (options.deleteMode === 'top') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('top'));
        } else if (options.deleteMode === 'bottom') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('bottom'));
        }

        const finalLines = processedLines.filter(line => line !== null && line.length > 0);

        const rowCount = finalLines.length > 1 ? finalLines.length - 1 : 0;

        const finalContent = finalLines.join('\n');

        if (!finalContent) {
            throw new Error('Файл пуст после обработки. Проверьте правила замен.');
        }

        const outputDir = appSettings.saveDirectory || path.join(os.homedir(), 'Downloads');
        await fs.mkdir(outputDir, { recursive: true });

        const parsedPath = path.parse(filePath);
        const baseName = `${parsedPath.name}_fixed`;
        const extension = parsedPath.ext || '.csv';
        
        let finalPath = path.join(outputDir, baseName + extension);
        let counter = 1;
        while (fsSync.existsSync(finalPath)) {
            finalPath = path.join(outputDir, `${baseName}(${counter})${extension}`);
            counter++;
        }

        // Запись файла
        await fs.writeFile(finalPath, finalContent, 'utf8');

        return { 
            success: true, 
            outputPath: finalPath, 
            rowCount: rowCount 
        };

    } catch (error) {
        console.error('Ошибка при обработке CSV:', error);
        return { 
            success: false, 
            error: error.message || 'Ошибка при обработке' 
        };
    }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
