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

// ipcMain.handle('process-csv', async (event, { filePath, options }) => {
//     try {
//         const buffer = await fs.readFile(filePath);
//         let encoding = 'utf-8';

//         // Проверяем наличие BOM  для точного определения
//         if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
//             encoding = 'utf-16le';
//         } else {
//             try {
//                 new TextDecoder('utf-8', { fatal: true }).decode(buffer);
//             } catch (e) {
//                 // Если UTF-8 невалиден, значит это Windows-1251
//                 encoding = 'windows-1251';
//             }
//         }

//         // Декодируем буфер в строку с определенной кодировкой
//         let rawContent = new TextDecoder(encoding).decode(buffer);

//         rawContent = rawContent.replace(/\u0421/g, 'C').replace(/\u0441/g, 'c');

//         if (rawContent.charCodeAt(0) === 0xFEFF) {
//             rawContent = rawContent.slice(1);
//         }

//         let lines = rawContent.split(/\r?\n/);

//         // Поиск строки с загаловками
//         const headerIndex = lines.findIndex(line => 
//             line.includes('Designator') && 
//             line.includes('Layer') && 
//             line.includes('Center-X') && 
//             line.includes('Center-Y')
//         );

//         if (headerIndex > 0) {
//             console.log(`Найден маркер на строке ${headerIndex}, удаляем первые ${headerIndex} строк`);
//             lines = lines.slice(headerIndex);
//         } else if (headerIndex === 0) {
//             console.log('Маркер уже в начале, ничего не удаляем');
//         } else {
//             console.log('Маркер не найден, обрабатываем весь файл как есть');
//         }

//         let processedLines = lines.map((line, index) => {
//             let currentLine = line;

//             if (!currentLine.trim()) return null;

//             //  Меняет русскую С на латинскую C для конденсаторов, чтобы избежать проблем с кодировкой 
//             // currentLine = currentLine.replace(/\u0421/g, 'C').replace(/\u0441/g, 'c');
            
//             if (options.replacements && Array.isArray(options.replacements)) {
//                 options.replacements.forEach(rule => {
//                     if (rule.find) {
//                         const escapedSearch = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//                         const searchRegExp = new RegExp(escapedSearch, 'g');
//                         currentLine = currentLine.replace(searchRegExp, rule.replace || '');
//                     }
//                 });
//             }

//             if (options.removeEmptyQuotes) {
//                 // 1. Удаляем пустые кавычки после запятой и до запятой (например, ,"", -> ,)
//                 currentLine = currentLine.replace(/,\s*"\s*"\s*,/g, ',');
//                 // 2. Удаляем пустые кавычки в самом конце строки после запятой (например, ,"" -> удалится)
//                 currentLine = currentLine.replace(/,\s*"\s*"\s*$/g, '');
//                 // 3. Удаляем пустые кавычки в самом начале строки перед запятой (например, "" , -> удалится)
//                 currentLine = currentLine.replace(/^"\s*"\s*,/g, '');
//             }

//             let cells = currentLine.split(',').map(cell => cell.trim());

//             while (cells.length > 0 && cells[cells.length - 1] === "") {
//                 cells.pop();
//             }

//             return cells.join(',');
//         });

//         if (options.deleteMode === 'top') {
//             processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('top'));
//         } else if (options.deleteMode === 'bottom') {
//             processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('bottom'));
//         } else if (options.deleteMode === 'выводной'){
//             processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('выводной'));
//         } else if (options.deleteMode === 'геркон'){
//             processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('геркон'));
//         }


//         const finalLines = processedLines.filter(line => line !== null && line.length > 0);
//         const rowCount = finalLines.length > 1 ? finalLines.length - 1 : 0;
//         const finalContent = finalLines.join('\n');

//         if (!finalContent) {
//             throw new Error('Файл пуст после обработки. Проверьте правила замен.');
//         }

//         const outputDir = appSettings.saveDirectory || path.join(os.homedir(), 'Downloads');
//         await fs.mkdir(outputDir, { recursive: true });

//         const parsedPath = path.parse(filePath);
//         const baseName = `${parsedPath.name}_fixed`;
//         const extension = parsedPath.ext || '.csv';
        
//         let finalPath = path.join(outputDir, baseName + extension);
//         let counter = 1;
//         while (fsSync.existsSync(finalPath)) {
//             finalPath = path.join(outputDir, `${baseName}(${counter})${extension}`);
//             counter++;
//         }

//         const BOM = '\uFEFF';
//         await fs.writeFile(finalPath, BOM + finalContent, 'utf8');

//         return { 
//             success: true, 
//             outputPath: finalPath, 
//             rowCount: rowCount 
//         };

//     } catch (error) {
//         console.error('Ошибка при обработке CSV:', error);
//         return { 
//             success: false, 
//             error: error.message || 'Ошибка при обработке' 
//         };
//     }
// });


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

        // 1. Гарантированная замена русской 'С' на английскую 'C' (и строчной тоже)
        rawContent = rawContent.replace(/\u0421/g, 'C').replace(/\u0441/g, 'c');

        let lines = rawContent.split(/\r?\n/);

        // Поиск строки с заголовками
        const headerIndex = lines.findIndex(line => 
            line.includes('Designator') && 
            line.includes('Layer') && 
            line.includes('Center-X') && 
            line.includes('Center-Y')
        );

        if (headerIndex > 0) {
            console.log(`Найден маркер на строке ${headerIndex}, удаляем первые ${headerIndex} строк`);
            lines = lines.slice(headerIndex);
        } else if (headerIndex === 0) {
            console.log('Маркер уже в начале, ничего не удаляем');
        } else {
            console.log('Маркер не найден, обрабатываем весь файл как есть');
        }

        let processedLines = lines.map((line) => {
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

            return cells.join(',');
        });

        // Фильтрация по режиму удаления
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
        
        // 2. Умная очистка имени файла от старых суффиксов
        // Регулярное выражение удаляет _fixed, _top или _bottom с конца имени, если они там есть
        let cleanName = parsedPath.name.replace(/_(?:fixed|top|bottom)$/i, '');
        
        let suffix = '_fixed';
        if (options.deleteMode === 'top') {
            suffix = '_bottom';
        } else if (options.deleteMode === 'bottom') {
            suffix = '_top';
        }

        const baseName = `${cleanName}${suffix}`;
        const extension = parsedPath.ext || '.csv';
        
        let finalPath = path.join(outputDir, baseName + extension);
        let counter = 1;
        while (fsSync.existsSync(finalPath)) {
            finalPath = path.join(outputDir, `${baseName}(${counter})${extension}`);
            counter++;
        }

        const BOM = '\uFEFF';
        await fs.writeFile(finalPath, BOM + finalContent, 'utf8');

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