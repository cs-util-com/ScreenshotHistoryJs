import {
    startCapture,
    pauseCapture
} from './capture.js';
import {
    selectFolder,
    getFolderPath,
    restoreDirectoryHandle,
    getDirectoryHandle,
    getScreenshotFile,
    getScreenshotFileUrl,
    requestPermissionOnUserActivation
} from './fileAccess.js';
import {
    initDB,
    addScreenshot,
    searchScreenshots,
    exportDBToJson,
    saveCurrentDatabaseToFolder,
    getScreenshotsFromFolder,
    saveDbOnUserInteraction
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

// Add this global variable to store a reference to the update function
let updateUIWithNewScreenshot;

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

    // Initially hide capture buttons until folder is confirmed
    startCaptureButton.classList.add('hidden');
    pauseCaptureButton.classList.add('hidden');
    
    // Request folder if none selected
    if (!hasDirectoryHandle && !folderPath) {
        await selectFolder();
    }

    // If we have a folder path and directory handle, show capture buttons
    if (await getDirectoryHandle()) {
        startCaptureButton.classList.remove('hidden');
        
        // Check if capturing was active before reload
        const capturingActive = localStorage.getItem('capturingActive') === 'true';
        if (capturingActive) {
            startCapture();
            startCaptureButton.classList.add('hidden');
            pauseCaptureButton.classList.remove('hidden');
        }
    }

    // Add event listeners to handle user interactions for permission requests
    document.addEventListener('click', async () => {
        // Try to restore permissions on any click
        const permissionsRestored = await requestPermissionOnUserActivation();
        
        // Try to save database if needed
        saveDbOnUserInteraction();
        
        // Add UI feedback when permissions are restored
        if (permissionsRestored) {
            // Show a temporary notification
            const notification = document.createElement('div');
            notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg';
            notification.textContent = 'Folder permissions restored!';
            document.body.appendChild(notification);
            
            // Remove after 3 seconds
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.5s';
                setTimeout(() => notification.remove(), 500);
            }, 3000);
        }
    });

    // Enhanced focus detection to handle permission restoration automatically
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            // When tab becomes visible, check for needed permission restoration
            if (window._pendingPermissionRequest) {
                await requestPermissionOnUserActivation();
            }
        }
    });

    // Event listeners
    startCaptureButton.addEventListener('click', async () => {
        // Ensure we have permissions before starting
        await requestPermissionOnUserActivation();
        
        startCapture();
        startCaptureButton.classList.add('hidden');
        pauseCaptureButton.classList.remove('hidden');
        localStorage.setItem('capturingActive', 'true');
        
        // Save database while we have user activation
        saveDbOnUserInteraction();
    });

    pauseCaptureButton.addEventListener('click', () => {
        pauseCapture();
        pauseCaptureButton.classList.add('hidden');
        startCaptureButton.classList.remove('hidden');
        localStorage.setItem('capturingActive', 'false');
        
        // Save database while we have user activation
        saveDbOnUserInteraction();
    });

    selectFolderButton.addEventListener('click', async () => {
        const folderName = await selectFolder();
        if (folderName) {
            folderPathDisplay.textContent = folderName;
            folderDisplay.textContent = `Current folder: ${folderName}`;
            openFolderButton.classList.remove('hidden');
            
            // Initialize database for the new folder
            await initDB();
            
            // Load screenshots directly from the folder
            const allItems = await searchScreenshots('');
            displayDailyGroups(allItems);
            
            // Save database to the folder for future reference
            const dirHandle = await getDirectoryHandle();
            if (dirHandle) {
                await saveCurrentDatabaseToFolder();
            }

            startCaptureButton.classList.remove('hidden');
            if (localStorage.getItem('capturingActive') === 'true') {
                startCapture();
                startCaptureButton.classList.add('hidden');
                pauseCaptureButton.classList.remove('hidden');
            }
        }
        
        // Explicitly save database now that we have user activation
        const currentDirHandle = await getDirectoryHandle();
        if (currentDirHandle) {
            await saveCurrentDatabaseToFolder();
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
    
    // ENHANCEMENT: Set up a periodic UI refresh to ensure captures are visible
    function setupPeriodicUIRefresh() {
        // This will refresh the UI every 10 seconds
        const REFRESH_INTERVAL = 10000; // 10 seconds
        
        // Keep track of the last refresh time to avoid refreshing during user interactions
        let lastRefreshTime = Date.now();
        let refreshIntervalId = null;
        
        // Update the last refresh time whenever user interacts with the page
        const userInteractionEvents = ['click', 'scroll', 'keydown', 'mousemove'];
        userInteractionEvents.forEach(eventType => {
            document.addEventListener(eventType, () => {
                lastRefreshTime = Date.now();
            });
        });
        
        // Set up the interval that checks if refresh is needed
        refreshIntervalId = setInterval(async () => {
            // Only refresh if it's been at least 5 seconds since last user interaction
            if (Date.now() - lastRefreshTime > 5000) {
                try {
                    // Check if we need to refresh by comparing screenshot count
                    const currentItems = await searchScreenshots('');
                    
                    // Track the UI refresh in console (for debugging)
                    if (!window._lastRefreshCount || window._lastRefreshCount !== currentItems.length) {
                        console.log(`UI refresh: found ${currentItems.length} items`);
                        window._lastRefreshCount = currentItems.length;
                        displayDailyGroups(currentItems);
                    }
                } catch (error) {
                    console.warn('Error during automatic UI refresh:', error);
                }
            }
        }, REFRESH_INTERVAL);
        
        // Store the interval ID so it can be cleared if needed
        window._uiRefreshIntervalId = refreshIntervalId;
    }
    
    // Start the periodic UI refresh
    setupPeriodicUIRefresh();

    // Function to display items in daily groups
    function displayDailyGroups(items) {
        dailyGroups.innerHTML = '';
        
        if (!items || items.length === 0) {
            dailyGroups.innerHTML = '<div class="text-center py-10 text-gray-500">No items to display. Start capturing to see screenshots here.</div>';
            return;
        }
        
        // Filter out items without valid timestamps before grouping
        const validItems = items.filter(item => {
            const hasTimestamp = item.timestamp || item.endTime;
            if (!hasTimestamp) {
                console.warn('Skipping item without timestamp:', item);
            }
            return hasTimestamp;
        });

        // Group items by date
        const grouped = groupByDate(validItems);
        
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
                if (item.fileHandle || item.url) {
                    // It's a screenshot
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'h-40 relative bg-gray-700 flex items-center justify-center';
                    
                    const img = document.createElement('img');
                    if (item.url) {
                        img.src = item.url;
                    } else {
                        // If we don't have a URL yet, try to get one
                        img.dataset.timestamp = item.timestamp;
                        img.dataset.filename = item.filename;
                        loadImageForElement(img, item);
                    }
                    img.alt = item.ocrText || 'Screenshot';
                    img.className = 'w-full h-32 object-cover';
                    
                    // Display a loading indicator while the image loads
                    const loadingIndicator = document.createElement('div');
                    loadingIndicator.className = 'absolute inset-0 flex items-center justify-center';
                    loadingIndicator.innerHTML = '<span class="animate-pulse">Loading...</span>';
                    
                    // Handle successful image loading
                    img.onload = () => {
                        loadingIndicator.remove();
                    };
                    
                    // Handle image loading failure without recursively retrying
                    img.onerror = (e) => {
                        // Reduce warning verbosity - log only the first few errors
                        if (!window._failedImageCount) window._failedImageCount = 0;
                        window._failedImageCount++;
                        
                        if (window._failedImageCount <= 3) {
                            console.warn(`Failed to load image (${window._failedImageCount} of 3 shown)`);
                        } else if (window._failedImageCount === 4) {
                            console.warn(`Additional image loading errors will be suppressed`);
                        }
                        
                        // Create a shared placeholder image URL instead of generating it each time
                        const placeholderImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
                        
                        // Set a placeholder image to stop error cascade
                        img.src = placeholderImage;
                        img.style.backgroundColor = "#333";
                        
                        // Prevent further error handling
                        img.onerror = null;
                    };
                    
                    imgContainer.appendChild(loadingIndicator);
                    imgContainer.appendChild(img);
                    
                    // Extract repeated text container creation into a function
                    function createTextContainer(item, timestamp) {
                        const container = document.createElement('div');
                        container.className = 'px-4 py-2';
                        
                        const time = document.createElement('p');
                        time.textContent = formatTime(timestamp);
                        time.className = 'text-sm text-gray-400';
                        
                        const text = document.createElement('p');
                        text.textContent = item.ocrText ? truncateText(item.ocrText, 100) : 'No text detected';
                        text.className = 'text-sm overflow-hidden overflow-ellipsis max-h-16';
                        
                        // Store timestamp in data attribute for OCR updates
                        if (timestamp) {
                            text.dataset.timestamp = timestamp;
                        }
                        
                        container.appendChild(time);
                        container.appendChild(text);
                        return container;
                    }
                    
                    // Use the extracted function
                    gridItem.appendChild(imgContainer);
                    gridItem.appendChild(createTextContainer(item, item.timestamp));
                } else {
                    // It's a summary - simplified version with the same pattern
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
    
    // Make displayDailyGroups available globally for refreshing
    window.refreshDailyGroups = displayDailyGroups;

    // New helper function to load images - with additional error prevention
    async function loadImageForElement(imgElement, item, isFallback = false) {
        // Guard against multiple loading attempts
        if (imgElement.dataset.loadAttempted === 'true') {
            return; // Prevent recursive loading attempts
        }
        
        try {
            // Mark this element as having a loading attempt
            imgElement.dataset.loadAttempted = 'true';
            
            if (item.fileHandle) {
                // Get file directly from the fileHandle
                const fileData = await getScreenshotFile(item.fileHandle);
                if (fileData && fileData.url) {
                    imgElement.src = fileData.url;
                    return;
                }
            }
            
            if (isFallback) {
                // Try additional fallback methods
                if (window._savedBlobs && window._savedBlobs[item.timestamp]) {
                    const newUrl = URL.createObjectURL(window._savedBlobs[item.timestamp]);
                    imgElement.src = newUrl;
                } else {
                    const fallbackUrl = await getScreenshotFileUrl(item.timestamp);
                    if (fallbackUrl) {
                        imgElement.src = fallbackUrl;
                    } else {
                        // If all loading attempts fail, set a placeholder and stop trying
                        imgElement.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
                        imgElement.alt = "Image unavailable";
                        imgElement.style.backgroundColor = "#333";
                        // Remove loading indicator
                        const container = imgElement.closest('.relative');
                        if (container) {
                            const loadingIndicator = container.querySelector('div');
                            if (loadingIndicator) {
                                loadingIndicator.textContent = "Image unavailable";
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error loading image:', e);
            // Set a placeholder image to prevent further loading attempts
            imgElement.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
            imgElement.alt = "Image unavailable";
            imgElement.style.backgroundColor = "#333";
        }
    }

    // Group items by date - add extra validation
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

    // Format time for display - improved error handling
    function formatTime(timestamp) {
        // Handle undefined or null timestamps gracefully
        if (!timestamp) {
            return 'Unknown time';
        }
        
        try {
            let date;
            if (typeof timestamp === 'string') {
                // First try standard ISO format
                date = new Date(timestamp);
                
                // If that fails or gives an invalid date, try other formats
                if (isNaN(date.getTime())) {
                    // Handle our non-standard format with colons or dashes
                    if (timestamp.includes(':') || timestamp.includes('-')) {
                        // Replace colons with hyphens for consistency
                        const cleanTimestamp = timestamp
                            .replace(/:/g, '-')
                            .replace('Z', '')
                            .replace('T', ' ');
                        
                        // Try to parse as YYYY-MM-DD HH-MM-SS format
                        const parts = cleanTimestamp.split(' ');
                        if (parts.length === 2) {
                            const [datePart, timePart] = parts;
                            const [year, month, day] = datePart.split('-');
                            const [hour, minute, second] = timePart.split('-');
                            
                            date = new Date(
                                parseInt(year),
                                parseInt(month) - 1, // Month is 0-based
                                parseInt(day),
                                parseInt(hour),
                                parseInt(minute),
                                parseInt(second)
                            );
                        }
                    } else if (timestamp.length >= 14) {
                        // Try to parse YYYYMMDDHHMMSS format
                        const year = timestamp.substring(0, 4);
                        const month = timestamp.substring(4, 6);
                        const day = timestamp.substring(6, 8);
                        const hour = timestamp.substring(8, 10);
                        const minute = timestamp.substring(10, 12);
                        const second = timestamp.substring(12, 14);
                        
                        date = new Date(
                            parseInt(year),
                            parseInt(month) - 1, // Month is 0-based
                            parseInt(day),
                            parseInt(hour),
                            parseInt(minute),
                            parseInt(second)
                        );
                    }
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
            // Log warning but don't clutter console
            // console.warn('Error formatting time:', timestamp);
            return typeof timestamp === 'string' ? 
                timestamp.split('T')[1]?.substring(0, 5) || 'Unknown time' : 
                'Unknown time';
        }
    }

    // Truncate text to specified length
    function truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }
    
    // Create a function to add a new screenshot to the UI - modified for improved reliability
    async function addNewScreenshotToUI(screenshotInfo) {
        if (!screenshotInfo) return;
        
        // ENHANCEMENT: Force a full refresh for the first few screenshots
        // This helps ensure the UI is properly populated when starting from empty
        if (!window._totalAddedScreenshots) window._totalAddedScreenshots = 0;
        window._totalAddedScreenshots++;
        
        if (window._totalAddedScreenshots <= 5) {
            // For the first few screenshots, do a full refresh
            setTimeout(async () => {
                try {
                    const allItems = await searchScreenshots('');
                    displayDailyGroups(allItems);
                } catch (e) {
                    console.warn('Error during full UI refresh:', e);
                }
            }, 500);
            return;
        }
        
        // For later screenshots, use the existing incremental update approach
        // Prevent duplicate additions - check if this screenshot is already in the UI
        if (document.querySelector(`p[data-timestamp="${screenshotInfo.timestamp}"]`)) {
            // Screenshot already exists in UI, don't add it again
            return;
        }
        
        try {
            // Get the current date from the screenshot timestamp
            const date = screenshotInfo.timestamp.split('T')[0];
            const formattedDate = formatDate(date);
            
            // Create grid item for the new screenshot
            const gridItem = document.createElement('div');
            gridItem.className = 'rounded overflow-hidden shadow-lg bg-gray-800';
            
            const imgContainer = document.createElement('div');
            imgContainer.className = 'h-40 relative bg-gray-700 flex items-center justify-center';
            
            const img = document.createElement('img');
            img.src = screenshotInfo.url;
            img.alt = 'New Screenshot';
            img.className = 'w-full h-32 object-cover';
            
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'absolute inset-0 flex items-center justify-center';
            loadingIndicator.innerHTML = '<span class="animate-pulse">Loading...</span>';
            
            img.onload = () => {
                loadingIndicator.remove();
            };
            
            // Handle image loading failure without recursively retrying
            img.onerror = (e) => {
                // Reduce warning verbosity - log only the first few errors
                if (!window._failedImageCount) window._failedImageCount = 0;
                window._failedImageCount++;
                
                if (window._failedImageCount <= 3) {
                    console.warn(`Failed to load image (${window._failedImageCount} of 3 shown)`);
                } else if (window._failedImageCount === 4) {
                    console.warn(`Additional image loading errors will be suppressed`);
                }
                
                loadingIndicator.innerHTML = "Image not available";
                
                // Set a placeholder image to stop error cascade
                img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
                img.style.backgroundColor = "#333";
                
                // Prevent further error handling
                img.onerror = null;
            };
            
            imgContainer.appendChild(loadingIndicator);
            imgContainer.appendChild(img);
            
            const textContainer = document.createElement('div');
            textContainer.className = 'px-4 py-2';
            
            const time = document.createElement('p');
            time.textContent = formatTime(screenshotInfo.timestamp);
            time.className = 'text-sm text-gray-400';
            
            const text = document.createElement('p');
            text.textContent = 'Processing OCR...';
            text.className = 'text-sm overflow-hidden overflow-ellipsis max-h-16';
            
            // Store the timestamp in a data attribute to update the OCR text later
            text.dataset.timestamp = screenshotInfo.timestamp;
            
            textContainer.appendChild(time);
            textContainer.appendChild(text);
            
            gridItem.appendChild(imgContainer);
            gridItem.appendChild(textContainer);
            
            // Find section for today using DOM traversal instead of custom selector
            let todaySection = null;
            const headings = document.querySelectorAll('h2');
            
            // Loop through all h2 elements to find the one with matching date text
            for (const heading of headings) {
                if (heading.textContent === formattedDate) {
                    todaySection = heading;
                    break;
                }
            }
            
            if (!todaySection) {
                // Today's section doesn't exist yet, create it
                const newDateSection = document.createElement('div');
                newDateSection.className = 'mb-6';
                
                const dateHeading = document.createElement('h2');
                dateHeading.textContent = formattedDate;
                dateHeading.className = 'text-xl font-bold mb-4 border-b border-gray-600 pb-2';
                newDateSection.appendChild(dateHeading);
                
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4';
                grid.appendChild(gridItem); // Add the new screenshot
                
                newDateSection.appendChild(grid);
                
                // Add the new section at the top of dailyGroups
                if (dailyGroups.firstChild) {
                    dailyGroups.insertBefore(newDateSection, dailyGroups.firstChild);
                } else {
                    dailyGroups.appendChild(newDateSection);
                }
                
                // If this is the first item, clear any "no items" message
                const noItemsMessage = dailyGroups.querySelector('.text-gray-500');
                if (noItemsMessage) {
                    noItemsMessage.remove();
                }
            } else {
                // Find today's grid
                const parentSection = todaySection.closest('div');
                const grid = parentSection.querySelector('.grid');
                
                // Add the new screenshot at the beginning of the grid
                if (grid.firstChild) {
                    grid.insertBefore(gridItem, grid.firstChild);
                } else {
                    grid.appendChild(gridItem);
                }
            }
            
            // Update the OCR text when it becomes available (poll a few times)
            let attempts = 0;
            const maxAttempts = 5;
            const checkOcrText = async () => {
                attempts++;
                try {
                    // Make sure we have a live database connection
                    if (!db || !db.isOpen()) {
                        console.log('Database not open when checking OCR, initializing');
                        await initDB();
                    }
                    
                    // Get the screenshot record from the database
                    const dbEntry = await db.screenshots.get(screenshotInfo.timestamp);
                    
                    if (dbEntry && dbEntry.ocrText) {
                        // Update the text element with OCR text
                        const textElements = document.querySelectorAll(`p[data-timestamp="${screenshotInfo.timestamp}"]`);
                        textElements.forEach(el => {
                            el.textContent = dbEntry.ocrText ? truncateText(dbEntry.ocrText, 100) : 'No text detected';
                        });
                        return;
                    }
                    
                    // If we haven't reached max attempts and no OCR text yet, try again
                    if (attempts < maxAttempts) {
                        setTimeout(checkOcrText, 2000); // Try again in 2 seconds
                    } else {
                        // Give up after max attempts
                        const textElements = document.querySelectorAll(`p[data-timestamp="${screenshotInfo.timestamp}"]`);
                        textElements.forEach(el => {
                            el.textContent = 'OCR processing...';
                        });
                    }
                } catch (error) {
                    console.error('Error checking OCR text:', error);
                    
                    // Attempt to reopen the database if it's a DatabaseClosedError
                    if (error.name === 'DatabaseClosedError') {
                        console.log('Database was closed, attempting to reopen');
                        try {
                            await initDB();
                            // Try again immediately after reopening
                            if (attempts < maxAttempts) {
                                setTimeout(checkOcrText, 1000);
                            }
                        } catch (dbError) {
                            console.error('Failed to reopen database:', dbError);
                        }
                    }
                }
            };
            
            // Start checking for OCR text after a short delay
            setTimeout(checkOcrText, 2000);
            
        } catch (error) {
            console.error('Error adding new screenshot to UI:', error);
            
            // In case of error, trigger a full UI refresh as fallback
            setTimeout(async () => {
                try {
                    const allItems = await searchScreenshots('');
                    displayDailyGroups(allItems);
                } catch (e) {
                    console.warn('Error during fallback UI refresh:', e);
                }
            }, 1000);
        }
    }
    
    // Make the function accessible to other modules
    updateUIWithNewScreenshot = addNewScreenshotToUI;
    
    // Make updateUIWithNewScreenshot available globally
    window.updateUIWithNewScreenshot = updateUIWithNewScreenshot;

    // Implement infinite scroll with folder-based approach
    let pageSize = 20;
    let currentPage = 1;
    let loading = false;
    let allFolderItems = [];
    
    window.addEventListener('scroll', async () => {
        if (loading) return;
        
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        
        if (scrollTop + clientHeight >= scrollHeight - 300) {
            loading = true;
            currentPage++;
            
            // If we haven't loaded all items yet, scan folder for more
            if (allFolderItems.length === 0) {
                allFolderItems = await getScreenshotsFromFolder();
            }
            
            // Calculate the slice for this page
            const startIndex = pageSize * currentPage;
            const endIndex = startIndex + pageSize;
            const moreItems = allFolderItems.slice(startIndex, endIndex);
            
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

// Export the update function for use in other modules
export {
    updateUIWithNewScreenshot
};
