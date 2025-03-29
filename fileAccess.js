let directoryHandle = null;

async function selectFolder() {
    try {
        if (!('showDirectoryPicker' in window)) {
            alert('Your browser does not support the File System Access API. Please use Chrome/Edge or another compatible browser.');
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
        
        // More helpful error message to the user
        if (error.name === 'AbortError') {
            console.log('Folder selection was cancelled by user');
        } else if (error.name === 'SecurityError') {
            alert('Permission to access files was denied. Please try again and grant permission.');
        }
        
        return null;
    }
}

async function saveScreenshot(pngBlob, jpgBlob, timestamp) {
    if (!directoryHandle) {
        console.warn('No directory selected.');
        return;
    }

    // Verify we have write permission
    if (await verifyPermission(directoryHandle, true) === false) {
        console.warn('Permission to write to folder was lost. Screenshot save skipped.');
        window._pendingPermissionRequest = true;
        return;
    }

    try {
        // Format timestamp for more readable filenames (YYYY-MM-DD-HH-MM-SS)
        // Make sure we don't have any invalid characters like colons or dots in the filename
        // Fix: Use a more consistent format for filenames
        const isoDate = new Date(timestamp).toISOString();
        const formattedTimestamp = isoDate
            .replace(/:/g, '-')
            .replace(/\./g, '-')
            .replace('Z', '')
            .replace('T', '_');
        
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
            timestamp,
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

async function getScreenshotFileUrl(timestamp) {
    if (!directoryHandle) return null;
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
        return URL.createObjectURL(file);
    } catch (e) {
        console.error('Could not retrieve screenshot file:', e);
        return null;
    }
}

async function restoreDirectoryHandle() {
    const hasStoredHandle = localStorage.getItem('hasDirectoryHandle') === 'true';
    if (hasStoredHandle && !directoryHandle) {
        try {
            // Attempt to request permission again
            return !!(await selectFolder());
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
        
        // Iterate through all files in the directory
        for await (const entry of directoryHandle.values()) {
            // Skip non-file entries and non-image files
            if (entry.kind !== 'file') continue;
            
            const filename = entry.name;
            // Check if this is a screenshot file (based on our naming convention)
            if (filename.startsWith('screenshot_') && (filename.endsWith('.png') || filename.endsWith('.jpg'))) {
                try {
                    // Extract timestamp from filename
                    const timestampPart = filename.replace('screenshot_', '').replace('.png', '').replace('.jpg', '');
                    // Convert back to ISO format timestamp for consistency
                    const isoTimestamp = timestampPart
                        .replace('_', 'T')
                        .replace(/-/g, (match, offset) => {
                            // Replace the first 3 dashes to restore ISO format, but keep others as is
                            return offset < 10 ? ':' : match;
                        }) + 'Z';
                    
                    screenshots.push({
                        filename,
                        timestamp: isoTimestamp,
                        fileHandle: entry
                    });
                } catch (e) {
                    console.warn(`Could not process filename: ${filename}`, e);
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

async function getScreenshotFile(fileHandle) {
    try {
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        return { url, file };
    } catch (e) {
        console.error('Error getting screenshot file:', e);
        return null;
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
        if ((await fileHandle.queryPermission(opts)) === 'granted') {
            return true;
        }
        
        // Request permission explicitly, but this will fail if not triggered by user activation
        if ((await fileHandle.requestPermission(opts)) === 'granted') {
            return true;
        }
        
        return false;
    } catch (e) {
        console.warn('Permission verification error:', e);
        return false;
    }
}

// Add a function to attempt a permission request - this should be called during user interaction
async function requestPermissionOnUserActivation() {
    if (!directoryHandle || !window._pendingPermissionRequest) return false;
    
    try {
        const result = await verifyPermission(directoryHandle, true);
        if (result) {
            window._pendingPermissionRequest = false;
            return true;
        }
    } catch (e) {
        console.error('Error requesting permission on user activation:', e);
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
