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
    const hasDirectoryHandle = await restoreDirectoryHandle(false); // Pass false to avoid auto-showing picker
    
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
    
    // Don't request folder automatically - wait for user interaction

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
        window._refreshState.searchTerm = searchTerm;  // Store current search term
        const results = await searchScreenshots(searchTerm);
        displayDailyGroups(results);
        window._refreshState.itemCount = results.length;
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
        
        // Create sections for each date
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
                const itemElement = document.createElement('div');
                itemElement.className = 'screenshot-item';
                itemElement.innerHTML = `<img src="${item.url}" alt="Screenshot">`;
                grid.appendChild(itemElement);
            });
            
            dateSection.appendChild(grid);
            dailyGroups.appendChild(dateSection);
        }
    }
    
    // Make displayDailyGroups available globally for refreshing
    window.refreshDailyGroups = displayDailyGroups;

    // Group items by date - this function was missing
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

    // Format date for display - this function was missing
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

    // Initial data display - only if we have a directory handle
    if (await getDirectoryHandle()) {
        const allItems = await searchScreenshots('');
        displayDailyGroups(allItems);
    } else {
        // Show empty state when no folder selected
        dailyGroups.innerHTML = '<div class="text-center py-10 text-gray-500">Please select a folder to store screenshots.</div>';
    }
    
    // Simplified UI refresh mechanism
    function setupSimpleUIRefresh() {
        // Use a single global state object to track refresh state
        window._refreshState = {
            interval: 6000,           // Refresh every 6 seconds
            lastUserAction: Date.now(),
            searchTerm: '',           // Track current search term
            isRefreshing: false,      // Prevent concurrent refreshes
            itemCount: 0              // Track item count for change detection
        };
        
        // Update the last user action time on user interaction
        const userEvents = ['click', 'scroll', 'keydown', 'mousemove'];
        userEvents.forEach(event => {
            document.addEventListener(event, () => {
                window._refreshState.lastUserAction = Date.now();
            });
        });
        
        // Set up the refresh interval
        setInterval(async () => {
            try {
                // Skip if already refreshing or user was active in the last 2 seconds
                if (window._refreshState.isRefreshing || 
                    Date.now() - window._refreshState.lastUserAction < 2000) {
                    return;
                }
                
                window._refreshState.isRefreshing = true;
                
                // Only proceed if we have a directory handle
                if (!await getDirectoryHandle()) {
                    window._refreshState.isRefreshing = false;
                    return;
                }
                
                // Get results using the current search term
                const searchTerm = window._refreshState.searchTerm;
                const items = await searchScreenshots(searchTerm);
                
                // Only refresh if item count changed or forced refresh flag is set
                if (items.length !== window._refreshState.itemCount || window._newScreenshotCaptured) {
                    console.log(`UI refresh: found ${items.length} items with filter "${searchTerm || 'none'}"`);
                    displayDailyGroups(items);
                    window._refreshState.itemCount = items.length;
                    window._newScreenshotCaptured = false;
                }
                
                window._refreshState.isRefreshing = false;
            } catch (error) {
                console.warn('Error during UI refresh:', error);
                window._refreshState.isRefreshing = false;
            }
        }, window._refreshState.interval);
    }
    
    // Start the simplified UI refresh
    setupSimpleUIRefresh();

    // Replace the complex UI update function with a simpler version that just flags for refresh
    async function addNewScreenshotToUI(screenshotInfo) {
        if (!screenshotInfo) return;
        
        // Set flag for the periodic refresh to pick up
        window._newScreenshotCaptured = true;
        
        // Optionally force an immediate refresh if it's been a while since the last one
        const timeSinceLastRefresh = Date.now() - (window._lastRefreshTime || 0);
        if (timeSinceLastRefresh > 2000) {  // If more than 2 seconds since last refresh
            try {
                window._lastRefreshTime = Date.now();
                const currentFilter = window._refreshState?.searchTerm || '';
                const items = await searchScreenshots(currentFilter);
                displayDailyGroups(items);
                window._refreshState.itemCount = items.length;
            } catch (error) {
                console.warn('Error during immediate refresh:', error);
            }
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
