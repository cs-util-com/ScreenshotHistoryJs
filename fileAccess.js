let directoryHandle = null;

async function selectFolder() {
    try {
        if (!('showDirectoryPicker' in window)) {
            // Replace alert with Tailwind notification
            if (window.showNotification) {
                window.showNotification('Your browser does not support the File System Access API. Please use Chrome/Edge or another compatible browser.', 'error', 8000);
            } else {
                alert('Your browser does not support the File System Access API. Please use Chrome/Edge or another compatible browser.');
            }
            return null;
        }
        
        // Request the directory from the user
        directoryHandle = await window.showDirectoryPicker();
        
        // Get a user-friendly name for the folder
        let folderName = '';
        try {
            // Try to get the name of the folder
            folderName = directoryHandle.name;
            
            // Set the global window reference for other modules
            window.directoryHandle = directoryHandle;
            
            // Store in localStorage that we have a directory handle
            localStorage.setItem('hasDirectoryHandle', 'true');
            
            // Try to persist permission if possible
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const permission = await navigator.permissions.query({
                        name: 'persistent-storage'
                    });
                    if (permission.state === 'granted') {
                        await directoryHandle.requestPermission({ mode: 'readwrite' });
                    }
                } catch (permError) {
                    console.warn('Permission persistence not supported:', permError);
                }
            }
            
            // Check for folder ID file, create one if it doesn't exist
            const folderId = await getFolderIdentifier();
            localStorage.setItem('currentFolderId', folderId);
            
            // Try to import database from the folder if it exists
            await tryImportDatabaseFromFolder();
        } catch (e) {
            console.warn('Could not get folder name:', e);
            folderName = 'Selected Folder';
        }
        
        await setFolderPath(folderName);
        return folderName;
    } catch (error) {
        console.error('Error selecting folder:', error);
        
        // More helpful error message to the user with visual notification
        if (error.name === 'AbortError') {
            console.log('Folder selection was cancelled by user');
        } else if (error.name === 'SecurityError') {
            console.warn('Permission to access files was denied or not in a user gesture context.');
            if (window.showNotification) {
                window.showNotification('Permission to access files was denied. Please try again.', 'warning');
            }
        }
        
        return null;
    }
}

async function saveScreenshot(pngBlob, jpgBlob, timestamp) {
    if (!directoryHandle) {
        console.warn('No directory selected.');
        if (window.showNotification) {
            window.showNotification('No folder selected. Please select a folder first.', 'warning');
        }
        return null;
    }

    // Verify we have write permission without requesting it automatically
    if (await verifyPermission(directoryHandle, true) === false) {
        console.warn('Permission to write to folder was lost. Screenshot queued for later.');
        if (window.showNotification) {
            window.showNotification('Waiting for folder permission. Click anywhere to restore access.', 'info');
        }
        
        // Queue the screenshot for when permissions are restored
        if (!window._pendingScreenshots) {
            window._pendingScreenshots = [];
        }
        
        // Queue with the data needed to save later
        window._pendingScreenshots.push({
            pngBlob: pngBlob.slice(0),  // Clone the blobs to preserve them
            jpgBlob: jpgBlob.slice(0),
            timestamp
        });
        
        window._pendingPermissionRequest = true;
        return null;
    }

    try {
        // More robust timestamp formatting to ensure valid filenames
        let formattedTimestamp;
        
        try {
            // First verify the timestamp is a valid date
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                throw new Error('Invalid timestamp');
            }
            
            // Format it consistently
            formattedTimestamp = date.toISOString()
                .replace(/:/g, '-')
                .replace(/\./g, '-')
                .replace('Z', '')
                .replace('T', '_');
        } catch (e) {
            // If there's any issue with the timestamp, use current time as fallback
            console.warn('Invalid timestamp provided, using current time instead:', timestamp);
            formattedTimestamp = new Date().toISOString()
                .replace(/:/g, '-')
                .replace(/\./g, '-')
                .replace('Z', '')
                .replace('T', '_');
        }
        
        const pngFilename = `screenshot_${formattedTimestamp}.png`;
        const jpgFilename = `screenshot_${formattedTimestamp}.jpg`;
        
        let pngFile, jpgFile;
        try {
            pngFile = await directoryHandle.getFileHandle(pngFilename, { create: true });
        } catch (e) {
            console.error('Error creating PNG file:', e);
            throw e;
        }
        
        try {
            jpgFile = await directoryHandle.getFileHandle(jpgFilename, { create: true });
        } catch (e) {
            console.error('Error creating JPG file:', e);
            throw e;
        }

        try {
            await writeFile(pngFile, pngBlob);
            await writeFile(jpgFile, jpgBlob);
        } catch (e) {
            console.error('Error writing file content:', e);
            throw e;
        }

        // Create a permanent object URL that won't be garbage collected
        let imageUrl;
        let savedBlob;
        let savedFilename;
        
        // Delete the larger file
        if (pngBlob.size > jpgBlob.size) {
            try {
                await directoryHandle.removeEntry(pngFilename);
                savedBlob = jpgBlob.slice(0); // Create a copy of the blob
                imageUrl = URL.createObjectURL(savedBlob);
                savedFilename = jpgFilename;
            } catch (e) {
                console.error('Error removing PNG file:', e);
            }
        } else {
            try {
                await directoryHandle.removeEntry(jpgFilename);
                savedBlob = pngBlob.slice(0); // Create a copy of the blob
                imageUrl = URL.createObjectURL(savedBlob);
                savedFilename = pngFilename;
            } catch (e) {
                console.error('Error removing JPG file:', e);
            }
        }

        // Store a reference to the blob to prevent garbage collection
        if (!window._savedBlobs) window._savedBlobs = {};
        window._savedBlobs[timestamp] = savedBlob;

        // Perform OCR
        try {
            const ocr = await import('./ocr.js');
            const blobToUse = pngBlob.size > jpgBlob.size ? jpgBlob : pngBlob;
            await ocr.performOCR(blobToUse, timestamp, imageUrl);
        } catch (e) {
            console.error('Error during OCR:', e);
        }

        // Return information about the saved file
        return {
            timestamp,  // Keep the original timestamp for database consistency
            filename: savedFilename,
            url: imageUrl
        };

    } catch (error) {
        console.error('Error saving screenshot:', error);
        
        // Handle permission errors specifically
        if (error.name === 'SecurityError') {
            window._pendingPermissionRequest = true;
            console.warn('Permission denied when saving. Will try to restore permissions on next user interaction.');
        }
        return null;
    }
}

async function writeFile(fileHandle, blob) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

async function setFolderPath(path) {
    localStorage.setItem('folderPath', path);
}

async function getFolderPath() {
    return localStorage.getItem('folderPath');
}

async function getDirectoryHandle() {
    return directoryHandle;
}

// Add cache to avoid repeatedly trying to load the same failing URLs
const fileLoadAttempts = new Map();

async function getScreenshotFile(fileHandle) {
    if (!fileHandle) {
        return null;
    }
    
    // Check if we've already failed to load this file
    const filePath = fileHandle.name;
    if (fileLoadAttempts.has(filePath) && fileLoadAttempts.get(filePath) === 'failed') {
        return null;
    }
    
    try {
        const file = await fileHandle.getFile();
        // Verify the file isn't empty or corrupted
        if (file.size === 0) {
            console.warn(`File ${filePath} is empty`);
            fileLoadAttempts.set(filePath, 'failed');
            return null;
        }
        
        const url = URL.createObjectURL(file);
        fileLoadAttempts.set(filePath, 'success');
        return { url, file };
    } catch (e) {
        console.error('Error getting screenshot file:', e);
        // Mark this file as failed to prevent repeated attempts
        fileLoadAttempts.set(filePath, 'failed');
        return null;
    }
}

async function getScreenshotFileUrl(timestamp) {
    if (!directoryHandle) return null;
    
    // Check if we've already tried and failed to get this timestamp
    if (fileLoadAttempts.has(timestamp) && fileLoadAttempts.get(timestamp) === 'failed') {
        return null;
    }
    
    // Rebuild the filename pattern used in saveScreenshot
    const formattedTimestamp = timestamp
        .replace(/:/g, '-')
        .replace(/\./g, '-')
        .replace('Z', '')
        .replace('T', '_');
    const pngFilename = `screenshot_${formattedTimestamp}.png`;
    const jpgFilename = `screenshot_${formattedTimestamp}.jpg`;

    try {
        // Try PNG then JPG
        let fileHandle;
        try {
            fileHandle = await directoryHandle.getFileHandle(pngFilename);
        } catch { 
            fileHandle = await directoryHandle.getFileHandle(jpgFilename);
        }
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        fileLoadAttempts.set(timestamp, 'success');
        return url;
    } catch (e) {
        // Reduce verbosity by not logging every failure
        fileLoadAttempts.set(timestamp, 'failed');
        return null;
    }
}

async function restoreDirectoryHandle(showPickerOnFail = false) {
    const hasStoredHandle = localStorage.getItem('hasDirectoryHandle') === 'true';
    if (hasStoredHandle && !directoryHandle) {
        try {
            // Only attempt to auto-request folder if showPickerOnFail is true
            if (showPickerOnFail) {
                return !!(await selectFolder());
            } else {
                // Just return false without showing picker - user will need to click the button
                return false;
            }
        } catch (e) {
            console.warn('Could not auto-request folder permission:', e);
            return false;
        }
    }
    return !!directoryHandle;
}

async function getFolderIdentifier() {
    if (!directoryHandle) return null;
    
    try {
        // Try to read existing identifier file
        try {
            const fileHandle = await directoryHandle.getFileHandle('folder-id.txt');
            const file = await fileHandle.getFile();
            const id = await file.text();
            if (id && id.trim()) {
                return id.trim();
            }
        } catch (e) {
            // File doesn't exist, will create a new one
        }
        
        // Generate a new identifier
        const folderId = 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
        
        // Save identifier to folder
        const fileHandle = await directoryHandle.getFileHandle('folder-id.txt', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(folderId);
        await writable.close();
        
        return folderId;
    } catch (e) {
        console.error('Error getting/creating folder identifier:', e);
        return 'unknown_folder';
    }
}

/**
 * Scans the selected folder for screenshot files
 * This allows us to display images that exist in the folder even if they're not in the database
 */
async function scanFolderForScreenshots() {
    if (!directoryHandle) return [];
    
    try {
        const screenshots = [];
        const processedFiles = new Set(); // Prevent duplicate processing
        
        // Iterate through all files in the directory
        for await (const entry of directoryHandle.values()) {
            // Skip non-file entries and non-image files
            if (entry.kind !== 'file') continue;
            
            const filename = entry.name;
            // Skip already processed files
            if (processedFiles.has(filename)) continue;
            processedFiles.add(filename);
            
            // Check if this is a screenshot file (based on our naming convention)
            if (filename.startsWith('screenshot_') && (filename.endsWith('.png') || filename.endsWith('.jpg'))) {
                try {
                    // Extract timestamp from filename
                    const timestampPart = filename.replace('screenshot_', '').replace('.png', '').replace('.jpg', '');
                    
                    // Improved timestamp parsing with better millisecond handling
                    let isoTimestamp;
                    
                    try {
                        // Parse timestamps like "2025-03-29_03-18-57-386"
                        if (timestampPart.includes('_')) {
                            const [datePart, timePart] = timestampPart.split('_');
                            
                            // Parse the time part which may have milliseconds as the 4th segment
                            const timeSegments = timePart.split('-');
                            
                            if (timeSegments.length >= 3) {
                                // Format: YYYY-MM-DD_HH-MM-SS-ms
                                const hours = timeSegments[0];
                                const minutes = timeSegments[1];
                                const seconds = timeSegments[2];
                                const milliseconds = timeSegments.length > 3 ? `.${timeSegments[3]}` : '';
                                
                                // Construct a proper ISO timestamp
                                isoTimestamp = `${datePart}T${hours}:${minutes}:${seconds}${milliseconds}Z`;
                                
                                // Verify it parses correctly
                                const testDate = new Date(isoTimestamp);
                                if (isNaN(testDate.getTime())) {
                                    // If the timestamp with milliseconds fails, try without milliseconds
                                    isoTimestamp = `${datePart}T${hours}:${minutes}:${seconds}Z`;
                                    const testDateNoMs = new Date(isoTimestamp);
                                    if (isNaN(testDateNoMs.getTime())) {
                                        throw new Error('Invalid timestamp format');
                                    }
                                }
                            } else {
                                throw new Error('Invalid time segments');
                            }
                        } else {
                            throw new Error('Timestamp missing date-time separator');
                        }
                    } catch (e) {
                        // If we can't parse it with our improved method, try the file's modified time
                        // This ensures we can still display the image even without proper metadata
                        console.warn(`Could not parse timestamp from filename: ${filename}`, e);
                        
                        // Use file creation time or current time as fallback
                        const file = await entry.getFile();
                        isoTimestamp = file.lastModified ? 
                            new Date(file.lastModified).toISOString() : 
                            new Date().toISOString();
                    }
                    
                    // Verify the file is a valid image file
                    try {
                        const file = await entry.getFile();
                        // Skip empty files
                        if (file.size === 0) {
                            console.warn(`Skipping empty file: ${filename}`);
                            continue;
                        }
                    } catch (fileError) {
                        console.warn(`Couldn't access file ${filename}:`, fileError);
                        continue;
                    }
                    
                    screenshots.push({
                        filename,
                        timestamp: isoTimestamp,
                        fileHandle: entry
                    });
                } catch (e) {
                    // This is a fallback for files that couldn't be processed at all
                    // We'll use a generated timestamp based on the file's lastModified date
                    try {
                        const file = await entry.getFile();
                        const fallbackTimestamp = file.lastModified ? 
                            new Date(file.lastModified).toISOString() : 
                            new Date().toISOString();
                        
                        screenshots.push({
                            filename,
                            timestamp: fallbackTimestamp,
                            fileHandle: entry,
                            isReconstructed: true // Flag to indicate this timestamp was reconstructed
                        });
                        
                        console.log(`Recovered file with generated timestamp: ${filename} -> ${fallbackTimestamp}`);
                    } catch (fallbackErr) {
                        console.error(`Could not process file even with fallback: ${filename}`, fallbackErr);
                    }
                }
            }
        }
        
        // Sort by timestamp (newest first)
        screenshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        
        // Only log if this is the first time scanning or there's a significant change
        if (screenshots.length > 0 && 
            (!window._lastScreenshotCount || 
            Math.abs(window._lastScreenshotCount - screenshots.length) > 5)) {
            console.log(`Found ${screenshots.length} screenshots in folder`);
            window._lastScreenshotCount = screenshots.length;
        }
        return screenshots;
    } catch (e) {
        console.error('Error scanning folder for screenshots:', e);
        return [];
    }
}

async function saveDatabaseToFolder(dbJson) {
    if (!directoryHandle) return false;
    
    try {
        // Check if we still have permission
        if (await verifyPermission(directoryHandle, true) === false) {
            console.warn('Permission to write to folder was lost. Database save skipped.');
            return false;
        }
        
        const filename = 'screenshot-history-db.json';
        try {
            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            
            // Convert to blob and write
            const blob = new Blob([JSON.stringify(dbJson, null, 2)], { type: 'application/json' });
            await writable.write(blob);
            await writable.close();
            
            return true;
        } catch (e) {
            if (e.name === 'SecurityError') {
                console.warn('Permission denied when saving database. Will try again on next user interaction.');
                // Set a flag to retry on next user interaction
                window._needsDatabaseSave = true;
                return false;
            } else {
                throw e;
            }
        }
    } catch (e) {
        console.error('Error saving database to folder:', e);
        return false;
    }
}

async function loadDatabaseFromFolder() {
    if (!directoryHandle) return null;
    
    try {
        const filename = 'screenshot-history-db.json';
        try {
            const fileHandle = await directoryHandle.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const content = await file.text();
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    } catch (e) {
        console.error('Error loading database from folder:', e);
        return null;
    }
}

async function tryImportDatabaseFromFolder() {
    const dbData = await loadDatabaseFromFolder();
    if (dbData) {
        // Import will be handled by storage.js
        window._pendingDbImport = dbData;
        return true;
    }
    return false;
}

// Check if we have permission to the given directory handle
async function verifyPermission(fileHandle, writeAccess) {
    try {
        // Check if permission was already granted
        const opts = { mode: writeAccess ? 'readwrite' : 'read' };
        
        // Try a permission check without prompting
        const state = await fileHandle.queryPermission(opts);
        if (state === 'granted') {
            return true;
        }
        
        // If we're in a background context, don't try to request permission
        // as it will cause a SecurityError - instead return false
        if (document.visibilityState === 'hidden' || !isUserActivationValid()) {
            // Set flag to request on next user interaction
            window._pendingPermissionRequest = true;
            return false;
        }
        
        // Only try to request permission if we have user activation
        // This should be called during a user gesture (click, etc)
        const requestResult = await fileHandle.requestPermission(opts);
        return requestResult === 'granted';
    } catch (e) {
        if (e.name === 'SecurityError') {
            // We're not in a user gesture context, just mark for later
            window._pendingPermissionRequest = true;
            return false;
        }
        console.warn('Permission verification error:', e);
        return false;
    }
}

// Helper to check if we have valid user activation
function isUserActivationValid() {
    // Not all browsers support this API, so check first
    if ('userActivation' in navigator) {
        return navigator.userActivation.isActive;
    }
    
    // Fallback to just reporting true since we can't detect
    // We'll catch the SecurityError if it happens
    return true;
}

// Enhanced version to handle pending screenshots during permission recovery
async function requestPermissionOnUserActivation() {
    if (!directoryHandle) return false;
    
    try {
        if (window._pendingPermissionRequest) {
            const result = await verifyPermission(directoryHandle, true);
            if (result) {
                console.log('Permission successfully restored on user interaction');
                window._pendingPermissionRequest = false;
                
                // Process any pending screenshots that were queued during permission outage
                if (window._pendingScreenshots && window._pendingScreenshots.length > 0) {
                    console.log(`Processing ${window._pendingScreenshots.length} pending screenshots`);
                    if (window.showNotification) {
                        window.showNotification(`Processing ${window._pendingScreenshots.length} pending screenshots...`, 'info');
                    }
                    
                    // Take only the last few screenshots to avoid flooding
                    const recentScreenshots = window._pendingScreenshots.slice(-5);
                    
                    for (const item of recentScreenshots) {
                        try {
                            await saveScreenshot(item.pngBlob, item.jpgBlob, item.timestamp);
                        } catch (e) {
                            console.error('Error saving queued screenshot:', e);
                        }
                    }
                    
                    // Clear the pending queue
                    window._pendingScreenshots = [];
                }
                
                return true;
            } else if (window.showNotification) {
                // If permission request was shown but denied, show a message
                window.showNotification('Permission denied. Some features will be limited until you grant folder access.', 'error');
            }
        }
    } catch (e) {
        console.error('Error requesting permission on user activation:', e);
        if (window.showNotification) {
            window.showNotification('Error requesting folder permissions. Please try again.', 'error');
        }
    }
    return false;
}

export {
    selectFolder,
    saveScreenshot,
    getFolderPath,
    getDirectoryHandle,
    restoreDirectoryHandle,
    getScreenshotFileUrl,
    getFolderIdentifier,
    saveDatabaseToFolder,
    loadDatabaseFromFolder,
    scanFolderForScreenshots,
    getScreenshotFile,
    verifyPermission,
    requestPermissionOnUserActivation
};
