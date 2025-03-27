import {
    startCapture,
    pauseCapture
} from './capture.js';
import {
    selectFolder,
    getFolderPath,
    restoreDirectoryHandle,
    getDirectoryHandle
} from './fileAccess.js';
import {
    initDB,
    addScreenshot,
    searchScreenshots,
    exportDBToJson
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
    const db = await initDB();

    // UI elements
    const startCaptureButton = document.getElementById('startCapture');
    const pauseCaptureButton = document.getElementById('pauseCapture');
    const selectFolderButton = document.getElementById('selectFolder');
    const openFolderButton = document.getElementById('openFolder');
    const folderPathDisplay = document.getElementById('folderPath');
    const searchInput = document.getElementById('search');
    const dailyGroups = document.getElementById('dailyGroups');
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsButton = document.getElementById('openSettings');
    const closeSettingsButton = document.getElementById('closeSettings');
    const saveSettingsButton = document.getElementById('saveSettings');
    const folderDisplay = document.getElementById('folderDisplay');

    // Load settings from local storage
    const imageQuality = localStorage.getItem('imageQuality') || 80;
    const diffThreshold = localStorage.getItem('diffThreshold') || 3;
    const retentionPeriod = localStorage.getItem('retentionPeriod') || 90;
    const ocrLanguage = localStorage.getItem('ocrLanguage') || 'eng';
    const modelProvider = localStorage.getItem('modelProvider') || 'openai';
    const openaiApiKey = localStorage.getItem('openaiApiKey') || '';
    const geminiApiKey = localStorage.getItem('geminiApiKey') || '';
    const claudeApiKey = localStorage.getItem('claudeApiKey') || '';
    const localModelUrl = localStorage.getItem('localModelUrl') || 'http://localhost:11434';

    // Set values in the settings form
    document.getElementById('imageQuality').value = imageQuality;
    document.getElementById('diffThreshold').value = diffThreshold;
    document.getElementById('retentionPeriod').value = retentionPeriod;
    document.getElementById('ocrLanguage').value = ocrLanguage;
    document.getElementById('modelProvider').value = modelProvider;
    document.getElementById('openaiApiKey').value = openaiApiKey;
    document.getElementById('geminiApiKey').value = geminiApiKey;
    document.getElementById('claudeApiKey').value = claudeApiKey;
    document.getElementById('localModelUrl').value = localModelUrl;

    // Load folder path from local storage and check if we need to restore directory handle
    const folderPath = await getFolderPath();
    const hasDirectoryHandle = await restoreDirectoryHandle();
    
    if (!hasDirectoryHandle && !folderPath) {
        // Request folder if none selected
        await selectFolder();
    }

    if (folderPath) {
        folderPathDisplay.textContent = folderPath;
        folderDisplay.textContent = `Current folder: ${folderPath}`;
        
        if (hasDirectoryHandle) {
            openFolderButton.classList.remove('hidden');
        } else {
            // We have a path saved but no directoryHandle
            folderDisplay.textContent = `Current folder: ${folderPath} (Click "Select Folder" to restore access)`;
        }
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
        const folderName = await selectFolder();
        if (folderName) {
            folderPathDisplay.textContent = folderName;
            folderDisplay.textContent = `Current folder: ${folderName}`;
            openFolderButton.classList.remove('hidden');
            
            // Export the database to the new folder
            const dirHandle = await getDirectoryHandle();
            if (dirHandle) {
                await exportDBToJson(dirHandle);
            }
        }
    });

    openFolderButton.addEventListener('click', async () => {
        try {
            // This will only work if the browser supports launchDirectory
            // and the folder was selected with showDirectoryPicker()
            if (window.directoryHandle && window.directoryHandle.requestPermission) {
                await window.directoryHandle.requestPermission({ mode: 'readwrite' });
                // On some platforms/browsers, this might open the folder in the OS file explorer
                await window.showDirectoryPicker({ id: window.directoryHandle });
            }
        } catch (error) {
            console.error('Error opening folder:', error);
        }
    });

    searchInput.addEventListener('input', async (event) => {
        const searchTerm = event.target.value;
        const results = await searchScreenshots(searchTerm);
        displayDailyGroups(results);
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
        const modelProvider = document.getElementById('modelProvider').value;
        const openaiApiKey = document.getElementById('openaiApiKey').value;
        const geminiApiKey = document.getElementById('geminiApiKey').value;
        const claudeApiKey = document.getElementById('claudeApiKey').value;
        const localModelUrl = document.getElementById('localModelUrl').value;

        localStorage.setItem('imageQuality', imageQuality);
        localStorage.setItem('diffThreshold', diffThreshold);
        localStorage.setItem('retentionPeriod', retentionPeriod);
        localStorage.setItem('ocrLanguage', ocrLanguage);
        localStorage.setItem('modelProvider', modelProvider);
        localStorage.setItem('openaiApiKey', openaiApiKey);
        localStorage.setItem('geminiApiKey', geminiApiKey);
        localStorage.setItem('claudeApiKey', claudeApiKey);
        localStorage.setItem('localModelUrl', localModelUrl);

        settingsModal.classList.add('hidden');
    });

    // Initial data display
    const allItems = await searchScreenshots('');
    displayDailyGroups(allItems);

    // Function to display items in daily groups
    function displayDailyGroups(items) {
        dailyGroups.innerHTML = '';
        
        if (!items || items.length === 0) {
            dailyGroups.innerHTML = '<div class="text-center py-10 text-gray-500">No items to display. Start capturing to see screenshots here.</div>';
            return;
        }
        
        // Group items by date
        const grouped = groupByDate(items);
        
        // Create a section for each date
        for (const date in grouped) {
            const dateSection = document.createElement('div');
            dateSection.className = 'mb-6';
            
            // Add date heading
            const dateHeading = document.createElement('h2');
            dateHeading.textContent = formatDate(date);
            dateHeading.className = 'text-xl font-bold mb-4 border-b border-gray-600 pb-2';
            dateSection.appendChild(dateHeading);
            
            // Create grid for this date's items
            const grid = document.createElement('div');
            grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4';
            
            // Add each item to the grid
            grouped[date].forEach(item => {
                const gridItem = document.createElement('div');
                gridItem.className = 'rounded overflow-hidden shadow-lg bg-gray-800';
                
                // Check if this is a screenshot or a summary
                if (item.url) {
                    // It's a screenshot
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'h-40 relative bg-gray-700 flex items-center justify-center';
                    
                    const img = document.createElement('img');
                    img.src = item.url;
                    img.alt = item.ocrText || 'Screenshot';
                    img.className = 'w-full h-32 object-cover';
                    
                    // Display a loading indicator while the image loads
                    const loadingIndicator = document.createElement('div');
                    loadingIndicator.className = 'absolute inset-0 flex items-center justify-center';
                    loadingIndicator.innerHTML = '<span class="animate-pulse">Loading...</span>';
                    
                    // Handle successful image loading
                    img.onload = () => {
                        loadingIndicator.remove();
                        console.log("Image loaded successfully:", item.url);
                    };
                    
                    // Handle image loading failure
                    img.onerror = async (e) => {
                        console.error("Failed to load image:", item.url, e);
                        loadingIndicator.innerHTML = "Image not available";
                        if (window._savedBlobs && window._savedBlobs[item.timestamp]) {
                            const newUrl = URL.createObjectURL(window._savedBlobs[item.timestamp]);
                            img.src = newUrl;
                        } else {
                            const fallbackUrl = await getScreenshotFileUrl(item.timestamp);
                            if (fallbackUrl) {
                                console.log("Fallback file URL found:", fallbackUrl);
                                img.src = fallbackUrl;
                            }
                        }
                    };
                    
                    imgContainer.appendChild(loadingIndicator);
                    imgContainer.appendChild(img);
                    
                    const textContainer = document.createElement('div');
                    textContainer.className = 'px-4 py-2';
                    
                    const time = document.createElement('p');
                    time.textContent = formatTime(item.timestamp);
                    time.className = 'text-sm text-gray-400';
                    
                    const text = document.createElement('p');
                    text.textContent = item.ocrText ? truncateText(item.ocrText, 100) : 'No text detected';
                    text.className = 'text-sm overflow-hidden overflow-ellipsis max-h-16';
                    
                    textContainer.appendChild(time);
                    textContainer.appendChild(text);
                    
                    gridItem.appendChild(imgContainer);
                    gridItem.appendChild(textContainer);
                } else {
                    // It's a summary - leave this part unchanged
                    gridItem.className += ' summary-tile bg-blue-900 text-white';
                    
                    const summaryContainer = document.createElement('div');
                    summaryContainer.className = 'px-4 py-3';
                    
                    const summaryTitle = document.createElement('h3');
                    summaryTitle.textContent = 'Activity Summary';
                    summaryTitle.className = 'font-bold mb-2';
                    
                    const timeRange = document.createElement('p');
                    timeRange.textContent = `${formatTime(item.startTime)} - ${formatTime(item.endTime)}`;
                    timeRange.className = 'text-xs text-blue-300 mb-2';
                    
                    const summaryText = document.createElement('p');
                    summaryText.textContent = item.text;
                    summaryText.className = 'text-sm overflow-hidden overflow-ellipsis max-h-32';
                    
                    summaryContainer.appendChild(summaryTitle);
                    summaryContainer.appendChild(timeRange);
                    summaryContainer.appendChild(summaryText);
                    
                    gridItem.appendChild(summaryContainer);
                }
                
                grid.appendChild(gridItem);
            });
            
            dateSection.appendChild(grid);
            dailyGroups.appendChild(dateSection);
        }
    }

    // Group items by date
    function groupByDate(items) {
        return items.reduce((groups, item) => {
            // Get date from timestamp or endTime
            let timestamp = item.timestamp || item.endTime;
            if (!timestamp) {
                console.warn('Item missing timestamp:', item);
                return groups;
            }
            
            // Ensure we have a valid date string format
            let date = '';
            try {
                // Handle ISO string or other formats
                if (timestamp.includes('T')) {
                    date = timestamp.split('T')[0];
                } else {
                    // Try to extract YYYY-MM-DD format
                    const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})/);
                    if (match) {
                        date = `${match[1]}-${match[2]}-${match[3]}`;
                    } else {
                        // Use current date as fallback
                        date = new Date().toISOString().split('T')[0];
                    }
                }
            } catch (error) {
                console.error('Error parsing date from timestamp:', timestamp, error);
                // Use current date as fallback
                date = new Date().toISOString().split('T')[0];
            }
            
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(item);
            return groups;
        }, {});
    }

    // Format date for display
    function formatDate(dateStr) {
        try {
            // Handle different date formats
            let date;
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                // YYYY-MM-DD format
                date = new Date(dateStr + 'T00:00:00Z');
            } else {
                // Try parsing directly
                date = new Date(dateStr);
            }
            
            // Check if the date is valid
            if (isNaN(date.getTime())) {
                throw new Error('Invalid date');
            }
            
            return new Intl.DateTimeFormat('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(date);
        } catch (error) {
            console.error('Error formatting date:', dateStr, error);
            return dateStr; // Fall back to showing the raw date string
        }
    }

    // Format time for display
    function formatTime(timestamp) {
        try {
            let date;
            if (typeof timestamp === 'string') {
                if (timestamp.includes('T')) {
                    // ISO format
                    date = new Date(timestamp);
                } else {
                    // Try to parse YYYYMMDDHHMMSS format
                    const year = timestamp.substring(0, 4);
                    const month = timestamp.substring(4, 6);
                    const day = timestamp.substring(6, 8);
                    const hour = timestamp.substring(8, 10);
                    const minute = timestamp.substring(10, 12);
                    const second = timestamp.substring(12, 14);
                    
                    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
                }
            } else {
                date = new Date(timestamp);
            }
            
            if (isNaN(date.getTime())) {
                throw new Error('Invalid date');
            }
            
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.error('Error formatting time:', timestamp, error);
            return typeof timestamp === 'string' ? timestamp : 'Unknown time';
        }
    }

    // Truncate text to specified length
    function truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    // Implement infinite scroll
    let pageSize = 20;
    let currentPage = 1;
    let loading = false;
    
    window.addEventListener('scroll', async () => {
        if (loading) return;
        
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        
        if (scrollTop + clientHeight >= scrollHeight - 300) {
            loading = true;
            currentPage++;
            
            const moreItems = await db.screenshots
                .offset(currentPage * pageSize)
                .limit(pageSize)
                .toArray();
                
            if (moreItems.length > 0) {
                const currentItems = await searchScreenshots('');
                displayDailyGroups([...currentItems, ...moreItems]);
            }
            
            loading = false;
        }
    });

    // Schedule retention check
    scheduleRetentionCheck();
    
    // Schedule summarization
    scheduleSummarization();
    
    async function performSummarization() {
        try {
            // Get current time
            const now = new Date();
            
            // Calculate start and end times for the 30-minute chunk with 10-minute overlap
            const endTime = new Date(now);
            const startTime = new Date(now.getTime() - 40 * 60 * 1000); // 40 minutes ago (30 min + 10 min overlap)
            
            console.log(`Summarizing screenshots from ${startTime.toISOString()} to ${endTime.toISOString()}`);

            // Get screenshots in this time range
            const screenshots = await db.screenshots
                .where('timestamp')
                .between(startTime.toISOString(), endTime.toISOString())
                .toArray();

            if (screenshots.length === 0) {
                console.log('No screenshots to summarize.');
                return;
            }

            const ocrText = screenshots.map(s => s.ocrText).join('\n');
            const timestamps = screenshots.map(s => s.timestamp);

            await generateSummary(ocrText, timestamps);
            console.log('Summarization complete!');
        } catch (error) {
            console.error('Error performing summarization:', error);
        }
    }

    function scheduleSummarization() {
        // Run the summarization immediately and then every 30 minutes
        performSummarization();
        setInterval(performSummarization, 30 * 60 * 1000);
    }
});
