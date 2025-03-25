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
    const folderDisplay = document.getElementById('folderDisplay');
    const dailyGroups = document.getElementById('dailyGroups');

    // Load settings from local storage
    const imageQuality = localStorage.getItem('imageQuality') || 80;
    const diffThreshold = localStorage.getItem('diffThreshold') || 3;
    const retentionPeriod = localStorage.getItem('retentionPeriod') || 90;
    const ocrLanguage = localStorage.getItem('ocrLanguage') || 'eng';

    document.getElementById('imageQuality').value = imageQuality;
    document.getElementById('diffThreshold').value = diffThreshold;
    document.getElementById('retentionPeriod').value = retentionPeriod;
    document.getElementById('ocrLanguage').value = ocrLanguage;

    // Load folder path from local storage
    const folderPath = await getFolderPath();
    if (folderPath) {
        folderPathDisplay.textContent = folderPath;
        folderDisplay.textContent = `Current folder: ${folderPath}`;
    }

    // Check if capturing was active before reload
    const capturingActive = localStorage.getItem('capturingActive') === 'true';
    if (capturingActive) {
        startCapture();
        startCaptureButton.classList.add('hidden');
        pauseCaptureButton.classList.remove('hidden');
    }

    // Event listeners
    startCaptureButton.addEventListener('click', () => {
        startCapture();
        startCaptureButton.classList.add('hidden');
        pauseCaptureButton.classList.remove('hidden');
        localStorage.setItem('capturingActive', 'true');
    });

    pauseCaptureButton.addEventListener('click', () => {
        pauseCapture();
        pauseCaptureButton.classList.add('hidden');
        startCaptureButton.classList.remove('hidden');
        localStorage.setItem('capturingActive', 'false');
    });

    selectFolderButton.addEventListener('click', async () => {
        const path = await selectFolder();
        folderPathDisplay.textContent = path;
        folderDisplay.textContent = `Current folder: ${path}`;
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
    let allImages = await searchScreenshots('');
    displayDailyGroups(allImages);

    let displayedImagesCount = 0;
    const imagesPerLoad = 10;

    function displayDailyGroups(images) {
        dailyGroups.innerHTML = '';
        const grouped = groupByDate(images);

        for (const date in grouped) {
            const dateHeading = document.createElement('h2');
            dateHeading.textContent = date;
            dateHeading.className = 'text-xl font-bold mb-2 mt-4';
            dailyGroups.appendChild(dateHeading);

            const grid = document.createElement('div');
            grid.className = 'grid gap-4';
            let i = 0;
            while (i < imagesPerLoad && displayedImagesCount < images.length) {
                const imgElement = document.createElement('img');
                imgElement.src = images[displayedImagesCount].url;
                imgElement.alt = images[displayedImagesCount].ocrText;
                imgElement.className = 'w-full rounded shadow-md';
                grid.appendChild(imgElement);
                displayedImagesCount++;
                i++;
            }
            dailyGroups.appendChild(grid);
        }
    }

    function groupByDate(images) {
        return images.reduce((groups, image) => {
            const date = image.timestamp.slice(0, 10);
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(image);
            return groups;
        }, {});
    }

    window.addEventListener('scroll', () => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight) {
            loadMoreImages();
        }
    });

    async function loadMoreImages() {
        let allImages = await searchScreenshots('');
        displayDailyGroups(allImages);
    }

    // Schedule retention check
    scheduleRetentionCheck();
});
