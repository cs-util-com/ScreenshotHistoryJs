import {
    startCapture,
    pauseCapture
} from './capture.js';
import {
    selectFolder,
    getFolderPath
} from './fileAccess.js';
import {
    initDB,
    addScreenshot,
    searchScreenshots
} from './storage.js';
import {
    performOCR
} from './ocr.js';
import {
    compareScreenshots
} from './diffing.js';
import {
    generateSummary
} from './summarization.js';
import {
    scheduleRetentionCheck
} from './retention.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Dexie database
    await initDB();

    // UI elements
    const startCaptureButton = document.getElementById('startCapture');
    const pauseCaptureButton = document.getElementById('pauseCapture');
    const selectFolderButton = document.getElementById('selectFolder');
    const folderPathDisplay = document.getElementById('folderPath');
    const searchInput = document.getElementById('search');
    const imageGrid = document.getElementById('imageGrid');
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsButton = document.getElementById('openSettings');
    const closeSettingsButton = document.getElementById('closeSettings');
    const saveSettingsButton = document.getElementById('saveSettings');

    // Load folder path from local storage
    const folderPath = await getFolderPath();
    if (folderPath) {
        folderPathDisplay.textContent = folderPath;
    }

    // Event listeners
    startCaptureButton.addEventListener('click', () => {
        startCapture();
        startCaptureButton.classList.add('hidden');
        pauseCaptureButton.classList.remove('hidden');
    });

    pauseCaptureButton.addEventListener('click', () => {
        pauseCapture();
        pauseCaptureButton.classList.add('hidden');
        startCaptureButton.classList.remove('hidden');
    });

    selectFolderButton.addEventListener('click', async () => {
        const path = await selectFolder();
        folderPathDisplay.textContent = path;
    });

    searchInput.addEventListener('input', async (event) => {
        const searchTerm = event.target.value;
        const results = await searchScreenshots(searchTerm);
        displayImages(results);
    });

    // Settings Modal event listeners
    openSettingsButton.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettingsButton.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    saveSettingsButton.addEventListener('click', () => {
        // Save settings to local storage
        const imageQuality = document.getElementById('imageQuality').value;
        const diffThreshold = document.getElementById('diffThreshold').value;
        const retentionPeriod = document.getElementById('retentionPeriod').value;
        const ocrLanguage = document.getElementById('ocrLanguage').value;

        localStorage.setItem('imageQuality', imageQuality);
        localStorage.setItem('diffThreshold', diffThreshold);
        localStorage.setItem('retentionPeriod', retentionPeriod);
        localStorage.setItem('ocrLanguage', ocrLanguage);

        settingsModal.classList.add('hidden');
    });

    // Initial image display (all images)
    const allImages = await searchScreenshots('');
    displayImages(allImages);

    // Function to display images in the grid
    async function displayImages(images) {
        imageGrid.innerHTML = '';
        for (const image of images) {
            const imgElement = document.createElement('img');
            imgElement.src = image.url;
            imgElement.alt = image.ocrText;
            imgElement.className = 'w-full rounded shadow-md';
            imageGrid.appendChild(imgElement);
        }
    }

    // Schedule retention check
    scheduleRetentionCheck();
});
