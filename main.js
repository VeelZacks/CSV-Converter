const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const {TextDecoder} = require('util'); // Кириллица

let currentSessionLogs = ['Логи еще отсутствуют. Запустите конвертацию файлов.'];
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

// Функция подсчета расстояния Левенштейна
function editDistance(s1, s2) {
    s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

// Функция определения процента схожести строк (от 0.0 до 1.0)
function getSimilarity(s1, s2) {
    let longer = s1, shorter = s2;
    if (s1.length < s2.length) { longer = s2; shorter = s1; }
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

// Вспомогательная функция для чтения файлов в правильной кодировке
async function readAndNormalizeFile(filePath) {
    const buffer = await fs.readFile(filePath);
    let encoding = 'utf-8';
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        encoding = 'utf-16le';
    } else {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (e) { encoding = 'windows-1251'; }
    }
    let rawContent = new TextDecoder(encoding).decode(buffer);
    if (rawContent.charCodeAt(0) === 0xFEFF) rawContent = rawContent.slice(1);
    return rawContent.replace(/\u0421/g, 'C').replace(/\u0441/g, 'c').split(/\r?\n/);
}



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


ipcMain.handle('analyze-csv', async (event, { filePaths }) => {
    try {
        const allPartNumbers = new Set();
        const partCounts = {};

        // Вспомогательная функция для перевода номинала в базовые единицы (Фарады / Омы)
        function parseNominalValue(str) {
            if (!str) return null;
            const clean = str.toLowerCase().trim();
            const match = clean.match(/([0-9]+[unpmkr.]*[0-9]*)/);
            if (!match) return null;
            
            let valStr = match[1];
            if (/[unpmkr]/.test(valStr) && !/^[unpmkr]/.test(valStr) && !/[unpmkr]$/.test(valStr)) {
                valStr = valStr.replace(/([unpmkr])/, '.$1').replace(/[unpmkr]/, '');
                let multiplier = 1;
                if (clean.includes('u')) multiplier = 1e-6;
                else if (clean.includes('n')) multiplier = 1e-9;
                else if (clean.includes('p')) multiplier = 1e-12;
                else if (clean.includes('m')) multiplier = 1e-3;
                else if (clean.includes('k')) multiplier = 1e3;
                return parseFloat(valStr) * multiplier;
            }
            
            let num = parseFloat(valStr);
            if (isNaN(num)) return null;
            
            if (clean.includes('u')) return num * 1e-6;
            if (clean.includes('n')) return num * 1e-9;
            if (clean.includes('p')) return num * 1e-12;
            if (clean.includes('m') && !clean.includes('mq') && !clean.includes('mгн')) return num * 1e-3;
            if (clean.includes('k') && !clean.includes('kv')) return num * 1e3;
            
            return num;
        }

        for (const filePath of filePaths) {
            const lines = await readAndNormalizeFile(filePath);
            
            const headerIndex = lines.findIndex(line => 
                line.toLowerCase().includes('designator') && 
                line.toLowerCase().includes('layer') && 
                line.toLowerCase().includes('center-x')
            );
            if (headerIndex === -1) continue;

            const headerCells = lines[headerIndex].replace(/"/g, '').split(',').map(c => c.trim().toLowerCase());
            let partIdx = headerCells.findIndex(c => c.includes('part number') || c.includes('comment') || c.includes('partnumber'));
            if (partIdx === -1) partIdx = headerCells.findIndex(c => c.includes('val') || c.includes('device')); 
            if (partIdx === -1) continue;

            const dataLines = lines.slice(headerIndex + 1);
            for (const line of dataLines) {
                if (!line.trim()) continue;
                const cells = line.replace(/"/g, '').split(',').map(c => c.trim());
                if (cells[partIdx]) {
                    const pn = cells[partIdx];
                    allPartNumbers.add(pn);
                    partCounts[pn] = (partCounts[pn] || 0) + 1;
                }
            }
        }

        const items = Array.from(allPartNumbers).filter(p => p && p.trim().length > 2);
        const groups = [];
        const visited = new Set();

        for (let i = 0; i < items.length; i++) {
            if (visited.has(items[i])) continue;
            const currentGroup = [items[i]];

            for (let j = i + 1; j < items.length; j++) {
                if (visited.has(items[j])) continue;
                
                // Проверка физического номинала (емкость/сопротивление)
                const nominalI = parseNominalValue(items[i]);
                const nominalJ = parseNominalValue(items[j]);
                let isSameNominal = true;
                if (nominalI !== null && nominalJ !== null) {
                    if (Math.abs(nominalI - nominalJ) > (Math.min(nominalI, nominalJ) * 0.01)) {
                        isSameNominal = false; 
                    }
                }

                // Жесткая проверка рабочего напряжения (вольтаж)
                let isSameVoltage = true;
                const voltRegex = /(?:^|[^a-zA-Z0-9])([0-9]+[.]?[0-9]*)\s*v(?:$|[^a-zA-Z])/i;
                const voltI = items[i].match(voltRegex);
                const voltJ = items[j].match(voltRegex);
                if (voltI && voltJ) {
                    if (voltI[1] !== voltJ[1]) {
                        isSameVoltage = false; 
                    }
                }

                // Жесткая проверка светодиодов (LED) на разный цвет
                let isSameLedColor = true;
                const lowerI = items[i].toLowerCase();
                const lowerJ = items[j].toLowerCase();
                if (lowerI.includes('fyls') || lowerI.includes('kp-') || lowerI.includes('led')) {
                    const colorI = lowerI.match(/(ugc|bubc|surck|urck|vgc|ygc)$/);
                    const colorJ = lowerJ.match(/(ugc|bubc|surck|urck|vgc|ygc)$/);
                    if (colorI && colorJ && colorI[1] !== colorJ[1]) {
                        isSameLedColor = false; 
                    }
                }

                // Слияние разрешено только если совпали все физические критерии
                if (isSameNominal && isSameVoltage && isSameLedColor && getSimilarity(items[i], items[j]) >= 0.80) {
                    currentGroup.push(items[j]);
                    visited.add(items[j]);
                }
            }

            if (currentGroup.length > 1) {
                visited.add(items[i]);
                groups.push({
                    id: `group_${i}`,
                    components: currentGroup.map(name => ({ name, count: partCounts[name] || 0 }))
                });
            }
        }

        return { success: true, groups };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('process-csv', async (event, { filePath, options }) => {
    const logLines = [
        `=== Старт обработки: ${filePath} ===`,
        `Время: ${new Date().toLocaleString()}`,
        `Параметры: ${JSON.stringify(options)}`
    ];

    try {
        let lines = await readAndNormalizeFile(filePath);
        logLines.push(`Строк изначально: ${lines.length}`);

        const headerIndex = lines.findIndex(line => 
            line.toLowerCase().includes('designator') && 
            line.toLowerCase().includes('layer') && 
            line.toLowerCase().includes('center-x')
        );

        let headerLine = '';
        let partIdx = -1;

        if (headerIndex > -1) {
            logLines.push(`Маркер на строке ${headerIndex}, срезаем верх`);
            headerLine = lines[headerIndex];
            
            const headerCells = headerLine.replace(/"/g, '').split(',').map(c => c.trim().toLowerCase());
            partIdx = headerCells.findIndex(c => c.includes('part number') || c.includes('comment') || c.includes('partnumber') || c.includes('val'));
            
            lines = lines.slice(headerIndex);
        } else {
            logLines.push('Маркер не найден, берем файл целиком');
            headerLine = lines || '';
        }


        let ncLines = [];

        let processedLines = lines.map((line, idx) => {
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
                currentLine = currentLine.replace(/,\s*"\s*"\s*,/g, ',');
                currentLine = currentLine.replace(/,\s*"\s*"\s*$/g, '');
                currentLine = currentLine.replace(/^"\s*"\s*,/g, '');
            }

            let cells = currentLine.split(',').map(cell => cell.trim());

            if (idx > 0 && partIdx > -1 && cells[partIdx] && options.mergeMap) {
                const rawPN = cells[partIdx].replace(/"/g, '');
                if (options.mergeMap[rawPN]) {
                    cells[partIdx] = cells[partIdx].startsWith('"') ? `"${options.mergeMap[rawPN]}"` : options.mergeMap[rawPN];
                }
            }

            while (cells.length > 0 && cells[cells.length - 1] === "") {
                cells.pop();
            }

            const cleanLine = cells.join(',');

            if (idx === 0 && headerIndex >= 0) return cleanLine;

            if (cells.length > 0) {
                const lastCell = cells[cells.length - 1].toLowerCase();
                if (lastCell.includes('nc')) {
                    ncLines.push(cleanLine); 
                    if (options.deleteMode === 'nc' || options.saveNcSeparately) {
                        return null; 
                    }
                }
            }

            return cleanLine;
        });

        logLines.push(`Найдено NC-строк: ${ncLines.length}`);

        if (options.deleteMode && options.deleteMode !== 'nc' && options.deleteMode !== 'none') {
            const beforeCount = processedLines.filter(l => l !== null).length;
            if (options.deleteMode === 'top') {
                processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('top'));
            } else if (options.deleteMode === 'bottom') {
                processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('bottom'));
            } else if (options.deleteMode === 'выводной') {
                processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('выводной'));
            } else if (options.deleteMode === 'геркон') {
                processedLines = processedLines.filter(l => l && !l.toLowerCase().includes('геркон'));
            }
            logLines.push(`Режим '${options.deleteMode}' удалил строк: ${beforeCount - processedLines.filter(l => l !== null).length}`);
        }

        const finalLines = processedLines.filter(line => line !== null && line.length > 0);
        const rowCount = finalLines.length > 1 ? finalLines.length - 1 : 0;
        const finalContent = finalLines.join('\n');

        if (!finalContent) throw new Error('Файл пуст после обработки.');

        const outputDir = appSettings.saveDirectory || path.join(os.homedir(), 'Downloads');
        await fs.mkdir(outputDir, { recursive: true });

        const parsedPath = path.parse(filePath);
        let cleanName = parsedPath.name.replace(/_(?:fixed|top|bottom|nc|only_nc)$/i, '');

        let suffix = '_fixed';
        if (options.deleteMode === 'top') suffix = '_bottom';
        if (options.deleteMode === 'bottom') suffix = '_top';

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
        logLines.push(`Сохранен основной файл: ${finalPath} (строк данных: ${rowCount})`);

        let ncOutputPath = null;
        if (ncLines.length > 0 && options.saveNcSeparately) {
            const ncContentLines = [];
            if (headerLine) ncContentLines.push(headerLine);
            ncContentLines.push(...ncLines);
            
            const ncBaseName = `${cleanName}_only_nc`;
            ncOutputPath = path.join(outputDir, ncBaseName + extension);
            let ncCounter = 1;
            while (fsSync.existsSync(ncOutputPath)) {
                ncOutputPath = path.join(outputDir, `${ncBaseName}(${ncCounter})${extension}`);
                ncCounter++;
            }
            await fs.writeFile(ncOutputPath, BOM + ncContentLines.join('\n'), 'utf8');
            logLines.push(`Сохранен NC файл: ${ncOutputPath}`);
        }

        logLines.push('=== Успешно завершено ===');
        currentSessionLogs = logLines;

        return { success: true, outputPath: finalPath, ncOutputPath, rowCount };

    } catch (error) {
        logLines.push(`!!! ОШИБКА !!!: ${error.message}`);
        console.error('Ошибка:', error);
        currentSessionLogs = logLines;
        return { success: false, error: error.message || 'Ошибка при обработке' };
    }
});





ipcMain.handle('get-latest-logs', async () => {
    return { success: true, logs: currentSessionLogs.join('\n') };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
