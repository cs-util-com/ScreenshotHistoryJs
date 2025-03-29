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

    try {
        // Format timestamp for more readable filenames (YYYY-MM-DD-HH-MM-SS)
        // Make sure we don't have any invalid characters like colons or dots in the filename
        const formattedTimestamp = timestamp
            .replace(/:/g, '-')
            .replace(/\./g, '-')
            .replace('Z', '')
            .replace('T', '_');
            
        console.log('Formatted timestamp for filename:', formattedTimestamp);
        
        const pngFilename = `screenshot_${formattedTimestamp}.png`;
        const jpgFilename = `screenshot_${formattedTimestamp}.jpg`;
        
        console.log('Saving files with names:', pngFilename, jpgFilename);
            
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
        
        // Delete the larger file
        if (pngBlob.size > jpgBlob.size) {
            try {
                await directoryHandle.removeEntry(pngFilename);
                console.log('Deleted PNG, keeping JPG.');
                savedBlob = jpgBlob.slice(0); // Create a copy of the blob
                imageUrl = URL.createObjectURL(savedBlob);
            } catch (e) {
                console.error('Error removing PNG file:', e);
            }
        } else {
            try {
                await directoryHandle.removeEntry(jpgFilename);
                console.log('Deleted JPG, keeping PNG.');
                savedBlob = pngBlob.slice(0); // Create a copy of the blob
                imageUrl = URL.createObjectURL(savedBlob);
            } catch (e) {
                console.error('Error removing JPG file:', e);
            }
        }

        // Store a reference to the blob to prevent garbage collection
        if (!window._savedBlobs) window._savedBlobs = {};
        window._savedBlobs[timestamp] = savedBlob;
        
        console.log('Screenshot saved successfully. Image URL created:', imageUrl);

        // Perform OCR
        try {
            const ocr = await import('./ocr.js');
            const blobToUse = pngBlob.size > jpgBlob.size ? jpgBlob : pngBlob;
            await ocr.performOCR(blobToUse, timestamp, imageUrl);
        } catch (e) {
            console.error('Error during OCR:', e);
        }

    } catch (error) {
        console.error('Error saving screenshot:', error);
        console.error('Timestamp that caused error:', timestamp);
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
            console.log('Requesting folder permission automatically...');
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
                console.log('Found existing folder ID:', id);
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
        
        console.log('Created new folder ID:', folderId);
        return folderId;
    } catch (e) {
        console.error('Error getting/creating folder identifier:', e);
        return 'unknown_folder';
    }
}

async function saveDatabaseToFolder(dbJson) {
    if (!directoryHandle) return false;
    
    try {
        const filename = 'screenshot-history-db.json';
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        
        // Convert to blob and write
        const blob = new Blob([JSON.stringify(dbJson, null, 2)], { type: 'application/json' });
        await writable.write(blob);
        await writable.close();
        
        console.log('Database saved to folder successfully');
        return true;
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
            console.log('No existing database file found in this folder');
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
        console.log('Found database file in folder, will import');
        window._pendingDbImport = dbData;
        return true;
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
    loadDatabaseFromFolder
};
