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
    requestPermissionOnUserActivation,
    getThumbnailFile,
    openFileInSystemViewer
} from './fileAccess.js';
import {
    initDB,
    addScreenshot,
    searchScreenshots,
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

// Example initialization for image modal
let currentImageIndex = 0;
let currentImageList = [];

function openLargeImageViewer(imageList, startIndex = 0) {
    currentImageList = imageList;
    currentImageIndex = startIndex;

    // Create the lightbox elements
    const lightbox = document.createElement('div');
    lightbox.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'absolute top-4 right-4 text-white hover:text-gray-300 z-10';
    closeBtn.innerHTML = `
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
    `;
    closeBtn.addEventListener('click', () => {
        lightbox.remove();
    });

    // Create left navigation arrow
    const leftArrow = document.createElement('button');
    leftArrow.className = 'absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full p-2 focus:outline-none z-10';
    leftArrow.innerHTML = `
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
    `;
    leftArrow.addEventListener('click', () => {
        currentImageIndex = (currentImageIndex > 0) ? currentImageIndex - 1 : currentImageList.length - 1;
        showImage(currentImageIndex);
    });

    // Create right navigation arrow
    const rightArrow = document.createElement('button');
    rightArrow.className = 'absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full p-2 focus:outline-none z-10';
    rightArrow.innerHTML = `
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
    `;
    rightArrow.addEventListener('click', () => {
        currentImageIndex = (currentImageIndex < currentImageList.length - 1) ? currentImageIndex + 1 : 0;
        showImage(currentImageIndex);
    });

    // Create image container
    const imgContainer = document.createElement('div');
    imgContainer.className = 'relative max-w-screen-xl max-h-screen p-4 overflow-auto';

    // Create the image with a unique ID for easy selection
    const img = document.createElement('img');
    img.alt = 'Screenshot';
    img.className = 'max-w-full max-h-[90vh] object-contain';
    img.id = 'lightbox-current-image'; // Add ID for reliable selection

    // Add timestamp and other metadata
    const metaInfo = document.createElement('div');
    metaInfo.className = 'text-white text-sm mt-2';
    metaInfo.textContent = new Date(currentImageList[currentImageIndex].timestamp).toLocaleString();

    imgContainer.appendChild(img);
    imgContainer.appendChild(metaInfo);
    lightbox.appendChild(closeBtn);
    lightbox.appendChild(leftArrow);
    lightbox.appendChild(rightArrow);
    lightbox.appendChild(imgContainer);

    // Add close on click outside image
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.remove();
        }
    });

    // Add keyboard navigation
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            lightbox.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });

    document.body.appendChild(lightbox);

    // Show the image
    showImage(currentImageIndex);
}

// Show a given image index in the viewer
function showImage(index) {
    // Use ID selector instead of class selector with square brackets
    const img = document.querySelector('#lightbox-current-image');
    const metaInfo = document.querySelector('.text-white.text-sm.mt-2');
    if (img && metaInfo) {
        img.src = currentImageList[index].url;
        metaInfo.textContent = new Date(currentImageList[index].timestamp).toLocaleString();
    }
}

// Add arrow key navigation
document.addEventListener('keydown', (e) => {
    if (!currentImageList || currentImageList.length === 0) return;
    // Left arrow
    if (e.key === 'ArrowLeft') {
        currentImageIndex = (currentImageIndex > 0) ? currentImageIndex - 1 : currentImageList.length - 1;
        showImage(currentImageIndex);
    }
    // Right arrow
    if (e.key === 'ArrowRight') {
        currentImageIndex = (currentImageIndex < currentImageList.length - 1) ? currentImageIndex + 1 : 0;
        showImage(currentImageIndex);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Dexie database
    const db = await initDB();

    // UI elements
    const startCaptureButton = document.getElementById('startCapture');
    const pauseCaptureButton = document.getElementById('pauseCapture');
    const selectFolderButton = document.getElementById('selectFolder');
    const searchInput = document.getElementById('search');
    const dailyGroups = document.getElementById('dailyGroups');
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsButton = document.getElementById('openSettings');
    const closeSettingsButton = document.getElementById('closeSettings');
    const saveSettingsButton = document.getElementById('saveSettings');

    // Add notification utility function to the window object so it can be used from other modules
    window.showNotification = function(message, type = 'info', duration = 5000) {
        const existingNotification = document.querySelector('.notification-popup');
        if (existingNotification) {
            existingNotification.remove(); // Remove any existing notification
        }
        
        // Create the notification element
        const notification = document.createElement('div');
        
        // Set base styles with Tailwind
        notification.className = 'notification-popup fixed z-50 bottom-4 right-4 p-4 rounded-lg shadow-lg transform transition-all duration-300 ease-in-out';
        
        // Add type-specific styles
        const typeStyles = {
            'success': 'bg-green-500 text-white',
            'error': 'bg-red-500 text-white',
            'warning': 'bg-yellow-500 text-white',
            'info': 'bg-blue-500 text-white'
        };
        
        notification.className += ' ' + (typeStyles[type] || typeStyles.info);
        
        // Add content
        notification.innerHTML = `
            <div class="flex items-center">
                <div class="mr-3">
                    ${type === 'success' ? '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                    ${type === 'error' ? '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' : ''}
                    ${type === 'warning' ? '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>' : ''}
                    ${type === 'info' ? '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' : ''}
                </div>
                <div>${message}</div>
                <button class="ml-auto text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        `;
        
        // Add to DOM
        document.body.appendChild(notification);
        
        // Fade in
        setTimeout(() => {
            notification.style.transform = 'translateY(0)';
            notification.style.opacity = '1';
        }, 10);
        
        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                notification.style.transform = 'translateY(20px)';
                notification.style.opacity = '0';
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 300);
            }, duration);
        }
        
        return notification;
    };

    // Load settings from local storage
    const imageQuality = localStorage.getItem('imageQuality') || 80;
    const diffThreshold = localStorage.getItem('diffThreshold') || 3;
    const retentionPeriod = localStorage.getItem('retentionPeriod') || 90;
    const ocrLanguage = localStorage.getItem('ocrLanguage') || 'eng';
    const ocrResolution = localStorage.getItem('ocrResolution') || 1280;
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
    document.getElementById('ocrResolution').value = ocrResolution;
    document.getElementById('modelProvider').value = modelProvider;
    document.getElementById('openaiApiKey').value = openaiApiKey;
    document.getElementById('geminiApiKey').value = geminiApiKey;
    document.getElementById('claudeApiKey').value = claudeApiKey;
    document.getElementById('localModelUrl').value = localModelUrl;

    // Load folder path from local storage and check if we need to restore directory handle
    const folderPath = await getFolderPath();
    const hasDirectoryHandle = await restoreDirectoryHandle(false); // Pass false to avoid auto-showing picker
    
    // Only show the folder name if we both have a path AND valid permissions
    if (folderPath && hasDirectoryHandle) {
        // Update the Select Folder button text to show the selected folder
        selectFolderButton.textContent = `Folder: ${folderPath}`;
    } else if (folderPath) {
        // We have a path but no valid permissions - hint this in the button text
        selectFolderButton.textContent = `Select Folder (reconnect to ${folderPath})`;
    } else {
        // Reset to default text if no folder is selected
        selectFolderButton.textContent = `Select Folder`;
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
        
        // Update button text if permissions were restored
        if (permissionsRestored) {
            const folderPath = await getFolderPath();
            if (folderPath) {
                selectFolderButton.textContent = `Folder: ${folderPath}`;
            }
            
            window.showNotification('Folder permissions restored!', 'success', 3000);
        }
        
        // Try to save database if needed
        saveDbOnUserInteraction();
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
            // Update the button text to show the selected folder
            selectFolderButton.textContent = `Folder: ${folderName}`;
            
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

    searchInput.addEventListener('input', async (event) => {
        const searchTerm = event.target.value.trim();
        window._refreshState.searchTerm = searchTerm;  // Store current search term
        
        // Show search loading indicator
        if (searchTerm) {
            dailyGroups.innerHTML = '<div class="text-center py-10 text-gray-500">Searching for "' + searchTerm + '"...</div>';
        }
        
        const results = await searchScreenshots(searchTerm);
        
        // If we got no results for a non-empty search term, show a helpful message
        if (results.length === 0 && searchTerm) {
            dailyGroups.innerHTML = `
                <div class="text-center py-10 text-gray-500">
                    No results found for "${searchTerm}". 
                    <p class="mt-2 text-sm">Try a different search term or check if OCR processing has completed for your screenshots.</p>
                </div>`;
            return;
        }
        
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
        const ocrResolution = document.getElementById('ocrResolution').value;
        const modelProvider = document.getElementById('modelProvider').value;
        const openaiApiKey = document.getElementById('openaiApiKey').value;
        const geminiApiKey = document.getElementById('geminiApiKey').value;
        const claudeApiKey = document.getElementById('claudeApiKey').value;
        const localModelUrl = document.getElementById('localModelUrl').value;

        localStorage.setItem('imageQuality', imageQuality);
        localStorage.setItem('diffThreshold', diffThreshold);
        localStorage.setItem('retentionPeriod', retentionPeriod);
        localStorage.setItem('ocrLanguage', ocrLanguage);
        localStorage.setItem('ocrResolution', ocrResolution);
        localStorage.setItem('modelProvider', modelProvider);
        localStorage.setItem('openaiApiKey', openaiApiKey);
        localStorage.setItem('geminiApiKey', geminiApiKey);
        localStorage.setItem('claudeApiKey', claudeApiKey);
        localStorage.setItem('localModelUrl', localModelUrl);

        // Show confirmation notification
        if (window.showNotification) {
            window.showNotification('Settings saved successfully', 'success', 2000);
        }

        settingsModal.classList.add('hidden');
    });

    // Function to display items in daily groups
    function displayDailyGroups(items) {
        dailyGroups.innerHTML = '';
        
        // Remove any existing search count indicators
        const existingSearchCount = document.querySelector('.search-result-count');
        if (existingSearchCount) {
            existingSearchCount.remove();
        }
        
        if (!items || items.length === 0) {
            dailyGroups.innerHTML = '<div class="text-center py-10 text-gray-500">No items to display. Start capturing to see screenshots here.</div>';
            return;
        }
        
        // Get the current search term from the search input directly
        // This ensures we use the complete, non-truncated value
        const searchTerm = document.getElementById('search').value.trim();
        
        // Add search result count if there's a search term
        if (searchTerm) {
            const searchResultCount = document.createElement('div');
            searchResultCount.className = 'search-result-count text-sm text-gray-500 mb-4';
            searchResultCount.textContent = `Found ${items.length} results for "${searchTerm}"`;
            dailyGroups.insertAdjacentElement('beforebegin', searchResultCount);
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
                itemElement.className = 'screenshot-item cursor-pointer overflow-hidden rounded-lg shadow-md hover:shadow-xl transition-shadow duration-200';
                
                // Create image with thumbnail if available
                const img = document.createElement('img');
                img.alt = 'Screenshot';
                img.className = 'w-full h-auto object-cover';
                img.loading = 'lazy'; // Enable lazy loading for performance
                
                // Set data attributes for later use in click handler
                itemElement.dataset.timestamp = item.timestamp || item.endTime;
                
                // Add a placeholder while the image loads
                img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
                
                // Try to load thumbnail asynchronously
                if (item.timestamp) {
                    (async () => {
                        const thumbnailData = await getThumbnailFile(item.timestamp);
                        if (thumbnailData && thumbnailData.url) {
                            img.src = thumbnailData.url;
                        } else if (item.url) {
                            // Fall back to full-size image if thumbnail not available
                            img.src = item.url;
                        }
                    })();
                    
                    // Add click handler to open the full-size image
                    itemElement.addEventListener('click', async () => {
                        await openScreenshot(item);
                    });
                }
                
                // If this is a summary and contains the search term, highlight it
                const searchTerm = window._refreshState.searchTerm;
                if (searchTerm && searchTerm.trim() !== '' && item.text && typeof item.text === 'string' && item.text.toLowerCase().includes(searchTerm.toLowerCase())) {
                    // Add a small visual indicator that this matched the search
                    const searchMatch = document.createElement('div');
                    searchMatch.className = 'absolute top-2 right-2 bg-yellow-500 text-xs text-white px-2 py-1 rounded-full';
                    searchMatch.textContent = 'Match';
                    itemElement.appendChild(searchMatch);
                }

                itemElement.appendChild(img);
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

    // Function to open a screenshot in the system viewer or lightbox
    async function openScreenshot(item) {
        if (!item || !item.fileHandle) {
            console.warn('Cannot open: missing file handle');
            return;
        }
        
        // Try to open with system viewer first
        const systemViewerSuccess = await openFileInSystemViewer(item.fileHandle);
        
        // If system viewer failed, show in lightbox
        if (!systemViewerSuccess) {
            showLightbox(item);
        }
    }

    // Create a lightbox for viewing images
    function showLightbox(item) {
        // We need to gather all images in the current group to enable navigation
        // Find the date section containing this item
        const dateSection = document.querySelector(`.screenshot-item[data-timestamp="${item.timestamp}"]`)?.closest('.mb-6');
        
        if (!dateSection) {
            console.warn('Could not find date section for image');
            // Fallback to just showing this single image
            openLargeImageViewer([{
                url: item.url,
                timestamp: item.timestamp
            }], 0);
            return;
        }
        
        // Get all image items in this date section
        const imageItems = Array.from(dateSection.querySelectorAll('.screenshot-item'));
        const currentIndex = imageItems.findIndex(el => el.dataset.timestamp === item.timestamp);
        
        // Create array of images with their URLs and timestamps
        const imageList = imageItems.map(el => {
            // For each image element, find its URL (src of the contained img tag)
            const imgElement = el.querySelector('img');
            return {
                url: imgElement?.src || '',
                timestamp: el.dataset.timestamp
            };
        }).filter(img => img.url); // Remove any items without URLs
        
        // Open the lightbox with our gathered images
        openLargeImageViewer(imageList, Math.max(0, currentIndex));
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
