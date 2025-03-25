let mediaStream = null;
let intervalId = null;
let lastImageData = null; // Store the last captured image data for diffing
let capturing = false;

import {
    saveScreenshot
} from './fileAccess.js';
import {
    compareScreenshots
} from './diffing.js';

async function startCapture() {
    if (capturing) return;
    capturing = true;

    try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true
        });
        const track = mediaStream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);

        intervalId = setInterval(async () => {
            try {
                const bitmap = await imageCapture.grabFrame();
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
                const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

                // Compare with the last image
                const diffThreshold = localStorage.getItem('diffThreshold') || 3;
                if (lastImageData && !compareScreenshots(imageData, lastImageData, diffThreshold / 100)) {
                    console.log('Screenshots are similar, skipping save.');
                    return;
                }

                lastImageData = imageData; // Update the last image data

                // Generate a clean timestamp for database storage (ISO format)
                const dbTimestamp = new Date().toISOString();
                
                const imageQuality = localStorage.getItem('imageQuality') || 80;
                const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const jpgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', imageQuality / 100));

                // Pass the ISO timestamp to saveScreenshot which will format it for filenames
                await saveScreenshot(pngBlob, jpgBlob, dbTimestamp);

            } catch (error) {
                console.error('Error capturing screenshot:', error);
                stopCapture();
            }
        }, 5000); // Every 5 seconds

    } catch (error) {
        console.error('Error starting screen capture:', error);
        capturing = false;
    }
}

function pauseCapture() {
    if (!capturing) return;
    capturing = false;

    stopCapture();
}

function stopCapture() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    lastImageData = null;
    localStorage.setItem('capturingActive', 'false');
}

export {
    startCapture,
    pauseCapture
};
