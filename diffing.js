function compareScreenshots(imgData1, imgData2, threshold = 0.03) {
    if (!imgData1 || !imgData2) {
        return true; // If either image is missing, consider them different
    }

    const width = imgData1.width;
    const height = imgData1.height;

    if (width !== imgData2.width || height !== imgData2.height) {
        console.warn('Images have different dimensions, considering them different.');
        return true;
    }

    const data1 = imgData1.data;
    const data2 = imgData2.data;

    let diffPixels = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data1.length; i += 4) {
        if (data1[i] !== data2[i] || // Red
            data1[i + 1] !== data2[i + 1] || // Green
            data1[i + 2] !== data2[i + 2] // Blue
        ) {
            diffPixels++;
        }
    }

    const diffPercentage = diffPixels / totalPixels;
    return diffPercentage > threshold;
}

export {
    compareScreenshots
};
