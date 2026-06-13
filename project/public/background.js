chrome.commands.onCommand.addListener((command) => {
  console.log("command:", command, Date.now());

  if (command !== 'toggle-marker' && command !== 'save-highlights') {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (typeof tabId !== 'number') {
      return;
    }

    chrome.tabs.sendMessage(tabId, { command }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('sendMessage failed:', chrome.runtime.lastError.message);
        return;
      }

      console.log(`${command} response:`, response);
    });
  });
});