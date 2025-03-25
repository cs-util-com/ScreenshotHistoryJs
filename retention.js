async function performRetentionCheck() {
    // TODO: Implement retention logic here
    console.log('Performing retention check...');
}

function scheduleRetentionCheck() {
    // Run the check on app load and then every 24 hours
    performRetentionCheck();
    setInterval(performRetentionCheck, 24 * 60 * 60 * 1000);
}

export {
    scheduleRetentionCheck
};
