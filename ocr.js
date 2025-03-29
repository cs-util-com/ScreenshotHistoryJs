import {
    addScreenshot
} from './storage.js';

// Cache for language loading status to avoid repeated errors
const languageLoadAttempts = {};

async function performOCR(imageSource, timestamp, imageUrl) {
    try {
        // Handle different input types (File object or Blob)
        let imageBlob;
        if (imageSource instanceof Blob) {
            imageBlob = imageSource;
        } else if (imageSource instanceof File) {
            imageBlob = imageSource;
        } else {
            console.error('Invalid image source type:', typeof imageSource);
            return;
        }
        
        // Ensure we have a valid imageUrl
        const finalImageUrl = imageUrl || URL.createObjectURL(imageBlob);
        
        // Store the blob in the global storage to prevent garbage collection
        if (!window._savedBlobs) {
            window._savedBlobs = {};
        }
        window._savedBlobs[timestamp] = imageBlob.slice(0);
        
        // Get OCR language from local storage or use browser language
        const ocrLanguage = localStorage.getItem('ocrLanguage') || 
            (navigator.language && navigator.language.split('-')[0]) || 'eng';
        
        // Check if we've already failed to load this language
        if (languageLoadAttempts[ocrLanguage] === 'failed') {
            console.warn(`Previously failed to load language: ${ocrLanguage}. Using English instead.`);
            // Fall back to English if it wasn't already the selected language
            if (ocrLanguage !== 'eng') {
                languageLoadAttempts['eng'] = 'pending';
            } else {
                // If English also failed, store the screenshot without OCR
                console.error('Cannot perform OCR: language data unavailable');
                await addScreenshot(timestamp, finalImageUrl, '');
                return;
            }
        }
        
        // Create a Tesseract worker with minimal logging
        const worker = await Tesseract.createWorker({
            // Only log once at 0% and once at 100% to reduce spam
            logger: m => {
                if (m.progress === 0 || m.progress === 1) {
                    console.log(`OCR ${m.status}: ${Math.round(m.progress * 100)}%`);
                }
            },
            errorHandler: err => console.error('Tesseract Worker Error:', err)
        });
        
        try {
            const requestedLang = (ocrLanguage === 'en') ? 'eng' : ocrLanguage;
            // Use CDN that actually works - try with current version
            await worker.loadLanguage(requestedLang);
            await worker.initialize(requestedLang);
            
            // Mark language as loaded successfully
            languageLoadAttempts[ocrLanguage] = 'loaded';
            
            // Perform recognition
            const { data } = await worker.recognize(imageBlob);
            const text = data.text;
            
            // Only log a short preview of the OCR text
            if (text && text.length > 0) {
                console.log('OCR completed successfully');
            } else {
                console.log('OCR completed with no text detected');
            }
            
            await addScreenshot(timestamp, finalImageUrl, text);
            
            // Terminate worker to free memory
            await worker.terminate();
            
        } catch (langError) {
            console.error(`Failed to load language '${ocrLanguage}':`, langError);
            
            // Mark this language as failed
            languageLoadAttempts[ocrLanguage] = 'failed';
            
            // Fall back to English if not already trying
            if (ocrLanguage !== 'eng') {
                console.log('Falling back to English language for OCR');
                try {
                    await worker.loadLanguage('eng');
                    await worker.initialize('eng');
                    
                    const { data } = await worker.recognize(imageBlob);
                    const text = data.text;
                    
                    console.log('OCR completed with English fallback');
                    await addScreenshot(timestamp, finalImageUrl, text);
                    
                } catch (engError) {
                    console.error('Failed to perform OCR with English fallback:', engError);
                    languageLoadAttempts['eng'] = 'failed';
                    await addScreenshot(timestamp, finalImageUrl, '');
                }
            } else {
                await addScreenshot(timestamp, finalImageUrl, '');
            }
            
            // Clean up
            await worker.terminate();
        }

    } catch (error) {
        console.error('OCR Error:', error);
        // Even if OCR fails, store the screenshot with empty text
        await addScreenshot(timestamp, imageUrl || null, '');
    }
}

export {
    performOCR
};
