import { addScreenshot } from './storage.js';

// Cache for language loading status to avoid repeated errors
const languageLoadAttempts = {};
// Create a shared placeholder image URL
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

// Minimal worker logger to reduce console spam
const minimalLogger = {
    logger: m => {
        if (m.status === 'recognizing text' && m.progress === 1) {
            console.log('OCR completed');
        }
    },
    errorHandler: err => console.error('Tesseract Worker Error:', err)
};

async function performOCR(imageSource, timestamp, imageUrl) {
    try {
        // Handle different input types (File object or Blob)
        const imageBlob = (imageSource instanceof Blob) ? imageSource : null;
        if (!imageBlob) {
            console.error('Invalid image source type:', typeof imageSource);
            await addScreenshot(timestamp, imageUrl, '');
            return;
        }
        
        // Ensure we have a valid imageUrl
        const finalImageUrl = imageUrl || URL.createObjectURL(imageBlob);
        
        // Store the blob in the global storage to prevent garbage collection
        if (!window._savedBlobs) {
            window._savedBlobs = {};
        }
        window._savedBlobs[timestamp] = imageBlob.slice(0);
        
        // Get OCR language, with fallback to browser language or English
        const ocrLanguage = localStorage.getItem('ocrLanguage') || 
            (navigator.language && navigator.language.split('-')[0]) || 'eng';
        
        // Handle previously failed language loading
        if (languageLoadAttempts[ocrLanguage] === 'failed') {
            if (ocrLanguage !== 'eng') {
                languageLoadAttempts['eng'] = 'pending';
            } else {
                await addScreenshot(timestamp, finalImageUrl, '');
                return;
            }
        }
        
        // Create a Tesseract worker with minimal logging
        const worker = await Tesseract.createWorker(minimalLogger);
        
        try {
            const requestedLang = (ocrLanguage === 'en') ? 'eng' : ocrLanguage;
            await worker.loadLanguage(requestedLang);
            await worker.initialize(requestedLang);
            
            // Mark language as loaded successfully
            languageLoadAttempts[ocrLanguage] = 'loaded';
            
            // Perform recognition
            const { data } = await worker.recognize(imageBlob);
            await addScreenshot(timestamp, finalImageUrl, data.text);
            await worker.terminate();
            
        } catch (langError) {
            console.error(`Failed to load language '${ocrLanguage}':`, langError);
            languageLoadAttempts[ocrLanguage] = 'failed';
            
            // Try English fallback if not already using it
            if (ocrLanguage !== 'eng') {
                try {
                    await worker.loadLanguage('eng');
                    await worker.initialize('eng');
                    
                    const { data } = await worker.recognize(imageBlob);
                    await addScreenshot(timestamp, finalImageUrl, data.text);
                } catch (engError) {
                    languageLoadAttempts['eng'] = 'failed';
                    await addScreenshot(timestamp, finalImageUrl, '');
                }
            } else {
                await addScreenshot(timestamp, finalImageUrl, '');
            }
            
            await worker.terminate();
        }
    } catch (error) {
        console.error('OCR Error:', error);
        await addScreenshot(timestamp, imageUrl || null, '');
    }
}

export {
    performOCR,
    PLACEHOLDER_IMAGE
};
