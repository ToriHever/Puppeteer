function qualifyURL(url) {
    var a = document.createElement('a');
    a.href = url;
    return a.href;
}

function sendToBackground(payload) {
    try {
        chrome.runtime.sendMessage(payload, function () {
            void chrome.runtime.lastError;
        });
    } catch (e) {
        // Extension context invalidated (reload/update) or runtime unavailable
    }
}

document.addEventListener("DOMContentLoaded", function (event) {

    sendToBackground({name: 'metaRefreshDetect', DOMContentLoaded: true});

    var metaRefreshNodes = document.querySelectorAll("meta[http-equiv='refresh']");
    if (metaRefreshNodes.length)
    {
        var metaRefreshElement = metaRefreshNodes.item(metaRefreshNodes.length - 1);
        var metaRefreshContent = metaRefreshElement.getAttribute('content');

        var metaRefreshParts = metaRefreshContent.split(/;\s?url\s?=\s?/i);
        var metaRefreshTimer = metaRefreshParts[0];
        var metaRefreshUrl = (typeof metaRefreshParts[1] != 'undefined') ? metaRefreshParts[1] : null;

        if (metaRefreshUrl)
        {
            sendToBackground({
                name: 'metaRefreshDetect',
                metaRefreshDetails: {url: qualifyURL(metaRefreshUrl), timer: metaRefreshTimer}
            });
        }
    }

    document.documentElement.addEventListener('click', function () {
        sendToBackground({name: 'metaRefreshDetect', userClicked: true});
    });
});
