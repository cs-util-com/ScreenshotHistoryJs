import {
    addScreenshot
} from './storage.js';

async function performOCR(imageBlob, timestamp) {
    try {
        const {
            data: {
                text
            }
        } = await Tesseract.recognize(
            imageBlob,
            'eng', // TODO: Make language configurable
            {
                logger: m => console.log(m)
            }
        );

        console.log('OCR Result:', text);
        await addScreenshot(timestamp, URL.createObjectURL(imageBlob), text);

    } catch (error) {
        console.error('OCR Error:', error);
    }
}

export {
    performOCR
};
