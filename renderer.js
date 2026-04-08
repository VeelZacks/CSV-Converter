let selectedFiles = [];
let currentSettings = { theme: 'light', saveDirectory: null };

const elements = {
    fileList: document.getElementById('fileList'),
    fileListItems: document.getElementById('fileListItems'),
    convertBtn: document.getElementById('convertBtn'),
    progressContainer: document.getElementById('progressContainer'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    successMessage: document.getElementById('successMessage'),
    fileLabel: document.getElementById('pickFilesBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    themeSelect: document.getElementById('themeSelect'),
    currentDirDisplay: document.getElementById('currentDirectory'),
    selectDirBtn: document.getElementById('selectDirectoryBtn'),
    closeModal: document.querySelector('.close'),
    // Новые элементы обработки
    removeQuotesCb: document.getElementById('removeEmptyQuotes'),
    findTextInput: document.getElementById('findText'),
    replaceTextInput: document.getElementById('replaceText')
};

async function initApp() {
    currentSettings = await window.electronAPI.getSettings();
    applyTheme(currentSettings.theme);
    updateDirectoryDisplay(currentSettings.saveDirectory);
    setupEventListeners();
}

function applyTheme(theme) {
    document.body.classList.toggle('dark-theme', theme === 'dark');
    currentSettings.theme = theme;
}

function updateDirectoryDisplay(dir) {
    elements.currentDirDisplay.textContent = dir || 'Загрузки (по умолчанию)';
}

function setupEventListeners() {
    elements.settingsBtn.onclick = () => {
        elements.themeSelect.value = currentSettings.theme;
        elements.settingsModal.style.display = 'flex';
    };
    elements.closeModal.onclick = () => elements.settingsModal.style.display = 'none';
    
    elements.themeSelect.onchange = async (e) => {
        applyTheme(e.target.value);
        await window.electronAPI.saveSettings({ theme: e.target.value });
    };

    elements.selectDirBtn.onclick = async () => {
        const dirPath = await window.electronAPI.selectDirectory();
        if (dirPath) {
            updateDirectoryDisplay(dirPath);
            await window.electronAPI.saveSettings({ saveDirectory: dirPath });
        }
    };

    elements.fileLabel.onclick = pickFiles;
    elements.convertBtn.onclick = startProcessing;
}

async function pickFiles() {
    try {
        const filePaths = await window.electronAPI.openFilePicker();
        
        if (filePaths && filePaths.length > 0) {
            selectedFiles = filePaths.map(p => ({
                path: p,
                name: p.split(/[\\/]/).pop()
            }));
            
            updateFileList();
            console.log("Файлы выбраны:", selectedFiles);
        }
    } catch (error) {
        console.error('Ошибка при выборе файлов:', error);
    }
}

function updateFileList() {
    elements.fileList.style.display = selectedFiles.length ? 'block' : 'none';
    elements.convertBtn.disabled = !selectedFiles.length;
    
    elements.fileListItems.innerHTML = selectedFiles.map((file, i) => `
        <div class="file-item">
            <div class="file-info">
                <span class="file-name" title="${file.path}">${file.name}</span>
            </div>
            <div style="color: #888;">CSV</div>
            <div style="text-align: right;">
                <button class="remove-btn" onclick="removeFile(${i})">✕</button>
            </div>
        </div>
    `).join('');
}
function updateFileList() {
    elements.fileList.style.display = selectedFiles.length ? 'block' : 'none';
    elements.convertBtn.disabled = !selectedFiles.length;
    elements.fileListItems.innerHTML = selectedFiles.map((file, i) => `
        <div class="file-item">
            <span class="file-name">${file.name}</span>
            <span>CSV</span>
            <button class="remove-btn" onclick="removeFile(${i})">✕</button>
        </div>
    `).join('');
}

window.removeFile = (index) => {
    selectedFiles.splice(index, 1);
    updateFileList();
};

async function startProcessing() {
    if (selectedFiles.length === 0) return;

    elements.progressContainer.style.display = 'block';
    elements.successMessage.style.display = 'none';
    elements.convertBtn.disabled = true;

    const options = {
        removeEmptyQuotes: elements.removeQuotesCb.checked,
        findText: elements.findTextInput.value,
        replaceText: elements.replaceTextInput.value
    };

    try {
        for (let i = 0; i < selectedFiles.length; i++) {
            const progress = Math.round(((i + 1) / selectedFiles.length) * 100);
            elements.progressBar.style.width = `${progress}%`;
            elements.progressText.textContent = `Обработка: ${selectedFiles[i].name}`;

            const result = await window.electronAPI.processCsv({ 
                filePath: selectedFiles[i].path, 
                options 
            });

            if (!result.success) {
                throw new Error(result.error);
            }
        }

        elements.progressText.textContent = 'Готово!';
        elements.successMessage.style.display = 'block';

        setTimeout(() => {
            resetUI();
        }, 2000);

    } catch (error) {
        console.error('Ошибка:', error);
        elements.progressText.textContent = `Ошибка: ${error.message}`;
        elements.convertBtn.disabled = false;
        alert(`Произошла ошибка: ${error.message}`);
    }
}

function resetUI() {
    selectedFiles = []; 
    updateFileList();  
    
    elements.progressContainer.style.display = 'none';
    elements.progressBar.style.width = '0%';
    elements.progressText.textContent = '';
    elements.successMessage.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', initApp);