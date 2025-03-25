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
        const pngFile = await directoryHandle.getFileHandle(`${timestamp}.png`, {
            create: true
        });
        const jpgFile = await directoryHandle.getFileHandle(`${timestamp}.jpg`, {
            create: true
        });

        await writeFile(pngFile, pngBlob);
        await writeFile(jpgFile, jpgBlob);

        // Delete the larger file
        if (pngBlob.size > jpgBlob.size) {
            await directoryHandle.removeEntry(`${timestamp}.png`);
            console.log('Deleted PNG, keeping JPG.');
            
            // Create an object URL for the screenshot
            const imageUrl = URL.createObjectURL(jpgBlob);
            
            // Perform OCR
            import('./ocr.js').then(ocr => {
                ocr.performOCR(jpgBlob, timestamp, imageUrl);
            });
        } else {
            await directoryHandle.removeEntry(`${timestamp}.jpg`);
            console.log('Deleted JPG, keeping PNG.');
            
            // Create an object URL for the screenshot
            const imageUrl = URL.createObjectURL(pngBlob);
            
            // Perform OCR
            import('./ocr.js').then(ocr => {
                ocr.performOCR(pngBlob, timestamp, imageUrl);
            });
        }

        console.log('Screenshot saved.');

    } catch (error) {
        console.error('Error saving screenshot:', error);
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

async function restoreDirectoryHandle() {
    const hasStoredHandle = localStorage.getItem('hasDirectoryHandle') === 'true';
    
    if (hasStoredHandle && !directoryHandle) {
        // We need to ask the user to select the folder again to get the handle
        // since browser security does not allow storing the actual handle
        console.log('Need to re-select folder to restore handle');
        return false;
    }
    
    return !!directoryHandle;
}

export {
    selectFolder,
    saveScreenshot,
    getFolderPath,
    getDirectoryHandle,
    restoreDirectoryHandle
};
