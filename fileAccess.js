let directoryHandle = null;

async function selectFolder() {
    try {
        directoryHandle = await window.showDirectoryPicker();
        await setFolderPath(directoryHandle.path);
        return directoryHandle.path;
    } catch (error) {
        console.error('Error selecting folder:', error);
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
        } else {
            await directoryHandle.removeEntry(`${timestamp}.jpg`);
            console.log('Deleted JPG, keeping PNG.');
        }

        console.log('Screenshot saved.');

        // Perform OCR
        import('./ocr.js').then(ocr => {
            ocr.performOCR(pngBlob.size > jpgBlob.size ? jpgBlob : pngBlob, timestamp);
        });

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

export {
    selectFolder,
    saveScreenshot,
    getFolderPath
};
