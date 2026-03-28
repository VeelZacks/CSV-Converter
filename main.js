const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;
const os = require('os');
const fsSync = require('fs');

let mainWindow = null;

const settingsPath = path.join(app.getPath('userData'), 'app-settings.json');

function loadSettings() {
  try {
    if (fsSync.existsSync(settingsPath)) {
      const data = fsSync.readFileSync(settingsPath, 'utf8');
      return { ...getDefaultSettings(), ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек:', error);
  }
  return getDefaultSettings();
}

function getDefaultSettings() {
  return {
    theme: 'light',
    saveDirectory: null 
  };
}

function saveSettings(settings) {
  try {
    fsSync.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Ошибка сохранения настроек:', error);
  }
}

let appSettings = loadSettings();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  mainWindow.loadFile('index.html');
  
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) event.preventDefault();
  });
  
  mainWindow.on('unresponsive', () => {
    console.error('Окно стало неотзывчивым');
  });
  
  mainWindow.on('closed', () => {
    console.log('Окно закрыто');
    mainWindow = null;
  });
}

ipcMain.handle('get-settings', () => appSettings);

ipcMain.handle('save-settings', async (event, newSettings) => {
  appSettings = { ...appSettings, ...newSettings };
  saveSettings(appSettings);
  return { success: true };
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-file-picker', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'ico'] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  } catch (error) {
    console.error('Ошибка выбора файлов:', error);
    return [];
  }
});

ipcMain.handle('validate-file', async (event, filePath) => {
  try {
    await fs.access(filePath);
    return { isValid: true, path: filePath };
  } catch (error) {
    return { isValid: false, error: error.message };
  }
});

ipcMain.handle('validate-files', async (event, filePaths) => {
  const validPaths = [];
  
  for (const path of filePaths) {
    try {
      await fs.access(path);
      validPaths.push(path);
    } catch (error) {
      console.warn(`Файл недоступен: ${path}`, error);
    }
  }
  
  return validPaths;
});

ipcMain.handle('convert-image', async (event, { filePath, format }) => {
  try {
    console.log(`Конвертация: ${filePath} -> ${format}`);
    
    const outputDir = appSettings.saveDirectory || path.join(os.homedir(), 'Downloads');
    await fs.mkdir(outputDir, { recursive: true });
    
    const imageBuffer = await fs.readFile(filePath);
    const originalName = path.parse(filePath).name;
    const timestamp = Date.now();
    const outputFileName = `${originalName}_${timestamp}.${format.toLowerCase()}`;
    const outputPath = path.join(outputDir, outputFileName);
    
    console.log(`Сохранение в: ${outputPath}`);
    
    let converter = sharp(imageBuffer);
    switch (format.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        converter = converter.flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 90, progressive: true, chromaSubsampling: '4:4:4' });
        break;
      
        case 'png':
          converter = converter.png({ 
            compressionLevel: 9, 
            adaptiveFiltering: true,
            palette: false 
          });
          break;
        
        case 'webp':
          converter = converter.webp({ 
            quality: 90, 
            lossless: false,
            nearLossless: false,
            smartSubsample: true
          });
          break;
        
        case 'gif':
          converter = converter.gif({ 
            quality: 90,
            effort: 7,
            reuse: true,
            palette: true
          });
          break;
                
        case 'tiff':
          converter = converter.tiff({ 
            compression: 'lzw',
            quality: 90,
            force: true
          });
          break;
        
        case 'avif':
          converter = converter.avif({ 
            quality: 75,
            lossless: false,
            speed: 5
          });
          break;
        
        default:
          converter = converter.png({ compressionLevel: 9 });
      }
    await converter.toFile(outputPath);
    console.log(`Успешно: ${outputPath}`);
    return { success: true, outputPath };
    
  } catch (error) {
    console.error('Ошибка конвертации:', error);
    return {
      success: false,
      error: error.message || 'Неизвестная ошибка конвертации'
    };
  }
});

process.on('uncaughtException', (error) => {
  console.error('НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('НЕОБРАБОТАННОЕ ОБЕЩАНИЕ:', reason);
});

app.whenReady().then(() => {
  createWindow();
  
  Menu.setApplicationMenu(null);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  console.log('Все окна закрыты');
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', (event, exitCode) => {
  console.log(`Приложение завершено с кодом: ${exitCode}`);
});