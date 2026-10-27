const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const {TextDecoder} = require('util'); // Кириллица

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
        icon: path.join(__dirname, 'assets', 'icon.png'),
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
        const buffer = await fs.readFile(filePath);
        let encoding = 'utf-8';

        // Проверяем наличие BOM для точного определения UTF-16 LE
        if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
            encoding = 'utf-16le';
        } else {
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            } catch (e) {
                encoding = 'windows-1251';
            }
        }

        let rawContent = new TextDecoder(encoding).decode(buffer);

        if (rawContent.charCodeAt(0) === 0xFEFF) {
            rawContent = rawContent.slice(1);
        }

        // Гарантированная замена русской 'С' на английскую 'C'
        rawContent = rawContent.replace(/\u0421/g, 'C').replace(/\u0441/g, 'c');

        let lines = rawContent.split(/\r?\n/);

        // Поиск строки с заголовками
        const headerIndex = lines.findIndex(line => 
            line.includes('Designator') && 
            line.includes('Layer') && 
            line.includes('Center-X') && 
            line.includes('Center-Y')
        );

        let headerLine = '';
        if (headerIndex > 0) {
            console.log(`Найден маркер на строке ${headerIndex}, удаляем первые ${headerIndex} строк`);
            headerLine = lines[headerIndex]; // Сохраняем заголовок для NC-файла
            lines = lines.slice(headerIndex);
        } else if (headerIndex === 0) {
            console.log('Маркер уже в начале, ничего не удаляем');
            headerLine = lines[0];
        } else {
            console.log('Маркер не найден, обрабатываем весь файл как есть');
            headerLine = lines[0] || '';
        }

        let ncLines = []; // Сюда будем собирать компоненты с NC

        let processedLines = lines.map((line, idx) => {
            let currentLine = line;
            if (!currentLine.trim()) return null;

            // Пользовательские замены
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
                currentLine = currentLine.replace(/,\s*"\s*"\s*,/g, ',');
                currentLine = currentLine.replace(/,\s*"\s*"\s*$/g, '');
                currentLine = currentLine.replace(/^"\s*"\s*,/g, '');
            }

            let cells = currentLine.split(',').map(cell => cell.trim());
            while (cells.length > 0 && cells[cells.length - 1] === "") {
                cells.pop();
            }

            const cleanLine = cells.join(',');

            // Пропускаем строку с заголовками, чтобы она не улетела в NC-компоненты
            if (idx === 0 && headerIndex >= 0) {
                return cleanLine;
            }

            // Проверка последней колонки на содержание NC
            if (cells.length > 0) {
                const lastCell = cells[cells.length - 1].toLowerCase();
                if (lastCell.includes('nc')) {
                    ncLines.push(cleanLine); 
                    
                    // Если выбран режим удаления NC, убираем из основного файла
                    if (options.deleteMode === 'nc') {
                        return null; 
                    }
                }
            }

            return cleanLine;
        });

        if (options.deleteMode === 'top') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('top'));
        } else if (options.deleteMode === 'bottom') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('bottom'));
        } else if (options.deleteMode === 'выводной') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('выводной'));
        } else if (options.deleteMode === 'геркон') {
            processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('геркон'));
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
        let cleanName = parsedPath.name.replace(/_(?:fixed|top|bottom|nc|only_nc)$/i, '');

        let suffix = '_fixed';
        if (options.deleteMode === 'top') {
            suffix = '_bottom';
        } else if (options.deleteMode === 'bottom') {
            suffix = '_top';
        }

        const baseName = `${cleanName}${suffix}`;
        const extension = parsedPath.ext || '.csv';
        const BOM = '\uFEFF';
        
        let finalPath = path.join(outputDir, baseName + extension);
        let counter = 1;
        while (fsSync.existsSync(finalPath)) {
            finalPath = path.join(outputDir, `${baseName}(${counter})${extension}`);
            counter++;
        }
        await fs.writeFile(finalPath, BOM + finalContent, 'utf8');

        // Если найдены компоненты с NC И вя опцих включено сохранение NC в отдельный файл
        let ncOutputPath = null;
        if (ncLines.length > 0 && options.saveNcSeparately) {
            // Формируем контент: заголовок + строки с NC
            const ncContentLines = [];
            if (headerLine) ncContentLines.push(headerLine);
            ncContentLines.push(...ncLines);
            
            const ncFinalContent = ncContentLines.join('\n');
            const ncBaseName = `${cleanName}_only_nc`;
            
            ncOutputPath = path.join(outputDir, ncBaseName + extension);
            let ncCounter = 1;
            while (fsSync.existsSync(ncOutputPath)) {
                ncOutputPath = path.join(outputDir, `${ncBaseName}(${ncCounter})${extension}`);
                ncCounter++;
            }
            await fs.writeFile(ncOutputPath, BOM + ncFinalContent, 'utf8');
        }

        return { 
            success: true, 
            outputPath: finalPath,
            ncOutputPath: ncOutputPath, 
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