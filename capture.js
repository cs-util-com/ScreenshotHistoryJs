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

// Add this import to get the UI update function
import { updateUIWithNewScreenshot } from './main.js';

async function startCapture() {
    if (capturing) return;

    try {
        // Stop any existing media stream
        stopCapture();

        capturing = true;

        // Request screen sharing
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true
        });

        // Add track ended listener to restart if user stops sharing
        mediaStream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => {
                console.log('Screen sharing ended by user');
                stopCapture();

                // If we still want to be capturing, automatically prompt user to restart
                if (localStorage.getItem('capturingActive') === 'true') {
                    setTimeout(() => {
                        startCapture();
                    }, 1000);
                }
            });
        });

        const track = mediaStream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);

        // Create a robust capture interval
        intervalId = setInterval(async () => {
            try {
                // Check if track is still active
                if (!track.readyState || track.readyState === 'ended') {
                    console.log('Track is no longer active, restarting capture');
                    stopCapture();
                    startCapture();
                    return;
                }

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
                const savedScreenshot = await saveScreenshot(pngBlob, jpgBlob, dbTimestamp);
                
                // Update the UI with the new screenshot
                if (savedScreenshot && typeof updateUIWithNewScreenshot === 'function') {
                    updateUIWithNewScreenshot(savedScreenshot);
                } else if (savedScreenshot && window.updateUIWithNewScreenshot) {
                    // Fallback to using window global if module import fails
                    window.updateUIWithNewScreenshot(savedScreenshot);
                }

            } catch (error) {
                console.error('Error capturing screenshot:', error);

                // Handle specific track errors by restarting
                if (error.name === 'InvalidStateError' ||
                    error.message.includes('Track') ||
                    error.message.includes('track')) {
                    console.log('Track error detected, restarting capture');
                    stopCapture();

                    // Try to restart after a short delay
                    setTimeout(() => {
                        if (localStorage.getItem('capturingActive') === 'true') {
                            startCapture();
                        }
                    }, 2000);
                }
            }
        }, 5000); // Every 5 seconds

    } catch (error) {
        console.error('Error starting screen capture:', error);
        capturing = false;
        localStorage.setItem('capturingActive', 'false');
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
