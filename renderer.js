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
    findTextInput: document.getElementById('findText'),
    replaceTextInput: document.getElementById('replaceText'),
    removeQuotesCb: document.getElementById('removeEmptyQuotes'),
    rulesContainer: document.getElementById('replacementRulesContainer'),
    addRuleBtn: document.getElementById('addRuleBtn'),
    deleteRowsSelect: document.getElementById('deleteRowsSelect'),
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

    elements.addRuleBtn.onclick = () => {
        const row = document.createElement('div');
        row.className = 'rule-item replacement-row';
        row.innerHTML = `
            <div class="input-group">
                <input type="text" class="settings-input find-text" placeholder="Что найти...">
                <span class="arrow">→</span>
                <input type="text" class="settings-input replace-text" placeholder="На что заменить...">
                <button class="remove-rule-btn" title="Удалить" style="margin-left: 8px; cursor:pointer;">✕</button>
            </div>
        `;
        elements.rulesContainer.appendChild(row);
    };

    elements.rulesContainer.onclick = (e) => {
        if (e.target.classList.contains('remove-rule-btn')) {
            const rows = document.querySelectorAll('.replacement-row');
            if (rows.length > 1) {
                e.target.closest('.replacement-row').remove();
            } else {
                const inputs = e.target.closest('.replacement-row').querySelectorAll('input');
                inputs.forEach(input => input.value = '');
            }
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

    const replacementRows = document.querySelectorAll('.replacement-row');
    const replacements = Array.from(replacementRows).map(row => ({
        find: row.querySelector('.find-text').value,
        replace: row.querySelector('.replace-text').value
    })).filter(rule => rule.find !== ''); 

    const options = {
        removeEmptyQuotes: elements.removeQuotesCb.checked,
        replacements: replacements, 
        deleteMode: elements.deleteRowsSelect.value 
    };

    elements.progressContainer.style.display = 'block';
    elements.successMessage.style.display = 'none';
    elements.convertBtn.disabled = true;

    let totalRowsProcessed = 0; // Счетчик для финального модального окна

    try {
        for (let i = 0; i < selectedFiles.length; i++) {
            const currentFile = selectedFiles[i];
            
            // Обновление прогресс-бара
            const progress = Math.round(((i + 1) / selectedFiles.length) * 100);
            elements.progressBar.style.width = `${progress}%`;
            elements.progressText.textContent = `Обработка (${i + 1}/${selectedFiles.length}): ${currentFile.name}`;

            const result = await window.electronAPI.processCsv({ 
                filePath: currentFile.path, 
                options 
            });

            if (!result.success) {
                throw new Error(`Файл "${currentFile.name}": ${result.error}`);
            }

            // Плюсуем количество строк результат из main
            totalRowsProcessed += result.rowCount;
        }

        elements.progressText.textContent = 'Все файлы успешно обработаны!';
        elements.successMessage.style.display = 'block';

        setTimeout(() => {
            alert(`Готово!\n\nВсего обработано строк (кроме заголовков): ${totalRowsProcessed}`);
            resetUI(); 
        }, 500);

    } catch (error) {
        console.error('Ошибка в процессе обработки:', error);
        elements.progressText.textContent = 'Ошибка обработки';
        elements.convertBtn.disabled = false; 
        
        alert(`Произошла ошибка:\n${error.message}`);
    }
}

function resetUI() {
    selectedFiles = []; 
    updateFileList();  

    elements.progressContainer.style.display = 'none';
    elements.progressBar.style.width = '0%';
    elements.progressText.textContent = '';
    elements.successMessage.style.display = 'none';

    if (elements.rulesContainer) {
        elements.rulesContainer.innerHTML = ''; // Сносим всё старое
        elements.addRuleBtn.click(); 
    }

    if (elements.removeQuotesCb) {
        elements.removeQuotesCb.checked = false;
    }

    if (elements.deleteRowsSelect) {
        elements.deleteRowsSelect.value = 'none'; 
    }

    elements.convertBtn.disabled = true; 

    console.log('Интерфейс очищен, базовое поле замены возвращено.');
}

function showResultModal(count) {
    alert(`Обработка завершена!\nВ файл записано строк (кроме заголовка): ${count}`);
}

document.addEventListener('DOMContentLoaded', initApp);