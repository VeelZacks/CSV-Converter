let selectedFiles = []; 
let currentSettings = { theme: 'light', saveDirectory: null };

const fileList = document.getElementById('fileList');
const fileListItems = document.getElementById('fileListItems');
const convertBtn = document.getElementById('convertBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const successMessage = document.getElementById('successMessage');
const fileLabel = document.querySelector('.file-label');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const themeSelect = document.getElementById('themeSelect');
const currentDirDisplay = document.getElementById('currentDirectory');
const selectDirBtn = document.getElementById('selectDirectoryBtn');
const closeModal = document.querySelector('.close');

async function initApp() {
  try {
    currentSettings = await window.electronAPI.getSettings();
    
    applyTheme(currentSettings.theme);
    
    updateDirectoryDisplay(currentSettings.saveDirectory);
    
    setupEventListeners();
    
  } catch (error) {
    console.error('Ошибка инициализации приложения:', error);
    alert('Не удалось загрузить настройки. Приложение будет работать со значениями по умолчанию.');
    applyTheme('light');
    updateDirectoryDisplay(null);
    setupEventListeners();
  }
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  currentSettings.theme = theme;
}

function updateDirectoryDisplay(dir) {
  if (dir && dir.trim() !== '') {
    currentDirDisplay.textContent = dir;
    currentDirDisplay.title = dir;
  } else {
    currentDirDisplay.textContent = 'Папка «Загрузки» (по умолчанию)';
    currentDirDisplay.title = '';
  }
  currentSettings.saveDirectory = dir;
}

function setupEventListeners() {
  settingsBtn.addEventListener('click', () => {
    themeSelect.value = currentSettings.theme;
    updateDirectoryDisplay(currentSettings.saveDirectory);
    settingsModal.style.display = 'block';
  });

  closeModal.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  themeSelect.addEventListener('change', async (e) => {
    applyTheme(e.target.value);
    try {
      await window.electronAPI.saveSettings({ theme: e.target.value });
    } catch (error) {
      console.error('Ошибка сохранения темы:', error);
      alert('Не удалось сохранить настройки темы');
    }
  });

  selectDirBtn.addEventListener('click', async () => {
    try {
      const dirPath = await window.electronAPI.selectDirectory();
      if (dirPath) {
        updateDirectoryDisplay(dirPath);
        await window.electronAPI.saveSettings({ saveDirectory: dirPath });
      }
    } catch (error) {
      console.error('Ошибка выбора папки:', error);
      alert('Не удалось выбрать папку');
    }
  });

  fileLabel.addEventListener('click', (e) => {
    e.stopPropagation();
    pickFiles();
  });

  convertBtn.addEventListener('click', startConversion);
}

async function pickFiles() {
  try {
    const filePaths = await window.electronAPI.openFilePicker();
    
    if (filePaths.length > 0) {
      const newFiles = filePaths.map(path => {
        const name = path.split(/[\\/]/).pop();
        return { 
          path, 
          name,
          format: 'jpg' 
        };
      });
      
      selectedFiles = [...selectedFiles, ...newFiles];
      updateFileList();
      convertBtn.disabled = selectedFiles.length === 0;
    }
  } catch (error) {
    console.error('Ошибка выбора файлов:', error);
    alert(`Не удалось выбрать файлы: ${error.message}`);
  }
}

function updateFileList() {
  if (selectedFiles.length === 0) {
    fileList.style.display = 'none';
    fileListItems.innerHTML = '';
    return;
  }

  fileList.style.display = 'block';
  
  fileListItems.innerHTML = selectedFiles.map((file, index) => `
    <div class="file-item">
      <div class="file-info">
        <span class="file-icon">🖼️</span>
        <span class="file-name" title="${file.name}">${file.name}</span>
      </div>
      <select class="format-select" data-index="${index}">
        <option value="png" ${file.format === 'png' ? 'selected' : ''}>PNG</option>
        <option value="jpg" ${file.format === 'jpg' ? 'selected' : ''}>JPG</option>
        <option value="webp" ${file.format === 'webp' ? 'selected' : ''}>WebP</option>
        <option value="gif" ${file.format === 'gif' ? 'selected' : ''}>GIF</option>
        <option value="tiff" ${file.format === 'tiff' ? 'selected' : ''}>TIFF</option>
        <option value="avif" ${file.format === 'avif' ? 'selected' : ''}>AVIF</option>
      </select>
      <button class="remove-btn" data-index="${index}">✕</button>
    </div>
  `).join('');
  
  document.querySelectorAll('.format-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      if (index >= 0 && index < selectedFiles.length) {
        selectedFiles[index].format = e.target.value;
      }
    });
  });
  
  document.querySelectorAll('.remove-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      if (index >= 0 && index < selectedFiles.length) {
        selectedFiles.splice(index, 1);
        updateFileList();
        convertBtn.disabled = selectedFiles.length === 0;
      }
    });
  });
}

async function startConversion() {
  if (selectedFiles.length === 0) return;
  
  progressContainer.style.display = 'block';
  progressText.textContent = 'Начинаем конвертацию...';
  convertBtn.disabled = true;
  successMessage.style.display = 'none';
  
  try {
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const progress = Math.round(((i + 1) / selectedFiles.length) * 100);
      
      progressBar.style.width = `${progress}%`;
      progressText.textContent = `Конвертация ${i + 1} из ${selectedFiles.length}: ${file.name}`;
      
      const result = await window.electronAPI.convertImage({
        filePath: file.path,
        format: file.format
      });
      
      if (!result || !result.success) {
        throw new Error(result?.error || 'Неизвестная ошибка конвертации');
      }
    }
    
    progressBar.style.width = '100%';
    progressText.textContent = 'Готово!';
    successMessage.style.display = 'block';
    
    setTimeout(resetUI, 3000);
    
  } catch (error) {
    console.error('Ошибка конвертации:', error);
    progressText.textContent = `Ошибка: ${error.message || 'Неизвестная ошибка'}`;
    convertBtn.disabled = false;
    alert(`Ошибка конвертации: ${error.message}`);
  }
}

function resetUI() {
  selectedFiles = [];
  fileList.style.display = 'none';
  fileListItems.innerHTML = '';
  progressContainer.style.display = 'none';
  progressBar.style.width = '0%';
  progressText.textContent = '';
  convertBtn.disabled = true;
  successMessage.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', initApp);