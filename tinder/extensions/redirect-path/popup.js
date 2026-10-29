var RedirectPathPopup = {
    clipboardPath: null,
    currentTab: null,
    copyFeedbackTimers: {hold: null, reset: null},

    init: function () {
        var self = this;

        this.clipboardPath = {
            csv: document.createElement('textarea'),
            text: document.createElement('textarea')
        };
        this.clipboardPath.csv.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        this.clipboardPath.text.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(this.clipboardPath.csv);
        document.body.appendChild(this.clipboardPath.text);

        var pathContainer = document.querySelector('.pathContainer');
        pathContainer.addEventListener('click', function (e) {
            var pathItem = e.target.closest('.pathItem:not(.noHeaders)');
            if (!pathItem || !pathContainer.contains(pathItem)) {
                return;
            }
            self.bindContainerClicks(e, pathItem);
        });

        document.querySelector('.copy').addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-copy]');
            if (!btn) {
                return;
            }
            e.preventDefault();

            var kind = btn.getAttribute('data-copy');
            var clipboardContainer = self.clipboardPath[kind];
            if (!clipboardContainer) {
                return;
            }

            var copyValue = clipboardContainer.value || '';
            if (!copyValue) {
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(copyValue)
                    .then(function () {
                        self.showCopyFeedback(btn);
                    })
                    .catch(function () {
                        if (self.copyWithExecCommand(copyValue)) {
                            self.showCopyFeedback(btn);
                        }
                    });
            } else {
                if (self.copyWithExecCommand(copyValue)) {
                    self.showCopyFeedback(btn);
                }
            }
        });

        document.querySelector('.send-to-ayima').addEventListener('click', function (e) {
            self.sendToAyima(e);
        });

        document.querySelectorAll('a[href]').forEach(function (a) {
            var href = a.getAttribute('href');
            if (!href || a.classList.contains('close')) {
                return;
            }
            a.addEventListener('click', function (e) {
                e.preventDefault();
                chrome.tabs.create({url: href});
            });
        });

        this.getTabAndRender();
    },

    hideAllResponseHeaders: function () {
        document.querySelectorAll('.pathItem').forEach(function (el) {
            el.classList.remove('expanded');
        });
        document.querySelectorAll('.pathResponseHeaders').forEach(function (el) {
            el.style.display = 'none';
        });
    },

    getTabAndRender: function () {
        var self = this;
        chrome.tabs.query({active: true, windowId: chrome.windows.WINDOW_ID_CURRENT}, function (tab) {
            var currentTab = tab[0];
            self.currentTab = currentTab;

            chrome.runtime.sendMessage({name: 'getTabPath', tabId: currentTab.id}, function (response) {
                var path = (response && response.path) ? response.path : [];
                self.renderPathPopup(path);

                var html = document.documentElement;
                var body = document.body;
                var h = html.offsetHeight;
                html.style.height = h + 'px';
                body.style.height = h + 'px';
            });
        });
    },

    bindContainerClicks: function (e, pathItemEl) {
        if (e.target.closest('a.close')) {
            e.preventDefault();
            this.hideAllResponseHeaders();
            return;
        }

        var headers = pathItemEl.querySelector('.pathResponseHeaders');
        var visible = headers.style.display === 'block' ||
            (headers.style.display === '' && window.getComputedStyle(headers).display !== 'none');

        if (!visible) {
            document.querySelectorAll('.pathItem').forEach(function (el) {
                el.classList.remove('expanded');
            });
            document.querySelectorAll('.pathResponseHeaders').forEach(function (el) {
                el.style.display = 'none';
            });
            pathItemEl.classList.add('expanded');
            headers.style.display = 'block';
        }
    },

    renderPathPopup: function (redirectPath) {
        var self = this;
        var pathContainer = document.querySelector('.pathContainer');
        pathContainer.innerHTML = '';

        if (redirectPath.length) {
            document.querySelectorAll('.copy button').forEach(function (btn) {
                btn.disabled = false;
            });
            document.querySelector('.send-to-ayima').disabled = false;
            self.clipboardPath.csv.value = "Status Code\tURL\tIP\tPage Type\tRedirect Type\tRedirect URL\t";
            self.clipboardPath.text.value = '';

            redirectPath.forEach(function (pathItem, idx) {
                var templateEl = document.querySelector('.template').cloneNode(true);

                templateEl.querySelector('h2').textContent = pathItem.url;

                var headerString = self.getHeaderString(pathItem);
                templateEl.querySelector('h3').textContent = headerString;

                self.clipboardPath.text.value += (idx + 1) + '. ' + pathItem.url + ' - ' + headerString + "\r";

                self.setNote(pathItem, templateEl);

                pathItem.statusObject.classes.forEach(function (c) {
                    templateEl.classList.add(c);
                });

                self.renderPathIcon(pathItem, templateEl);
                self.renderHeaders(pathItem, templateEl);

                templateEl.classList.remove('template');
                pathContainer.appendChild(templateEl);

                self.clipboardPath.csv.value += "\r" + pathItem.status_code;
                self.clipboardPath.csv.value += "\t" + pathItem.url;
                self.clipboardPath.csv.value += "\t" + pathItem.ip;
                self.clipboardPath.csv.value += "\t" + pathItem.type;

                var redirectType = pathItem.redirect_type;
                if (pathItem.status_code === 301 || pathItem.status_code === 308) {
                    redirectType = 'permanent';
                } else if (pathItem.status_code > 301) {
                    redirectType = 'temporary';
                }

                self.clipboardPath.csv.value += "\t" + redirectType;

                var redirectUrlString = pathItem.redirect_url ? pathItem.redirect_url : 'none';
                self.clipboardPath.csv.value += "\t" + redirectUrlString;
            });
        } else {
            var templateEl = document.querySelector('.template').cloneNode(true);

            templateEl.querySelector('h2').innerHTML = 'Sorry, there is currently no information available';
            templateEl.querySelector('h3').innerHTML = 'Load or refresh a page to gather information on your path.';

            templateEl.querySelector('.responseContainer').innerHTML =
                '<p id="note"><strong>Why this can happen:</strong><br>' +
                'Chrome does not provide redirect/request data for local pages (for example, localhost or file URLs), ' +
                'Chrome internal/settings pages, or tabs that were already open before installing Redirect Path or after a Chrome update. ' +
                'Open a new page or refresh this tab and try again.</p>';

            templateEl.classList.add('statusWarning', 'iconWarning', 'noHeaders');

            templateEl.classList.remove('template');
            pathContainer.appendChild(templateEl);
        }
    },

    setNote: function (pathItem, templateEl) {
        if (pathItem.status_code == 307 && pathItem.headers) {
            pathItem.headers.forEach(function (header) {
                if (header.name == 'Non-Authoritative-Reason' && header.value == 'HSTS') {
                    var note = templateEl.querySelector('p#note');
                    note.classList.remove('hide');
                    note.querySelector('strong').textContent =
                        'The server has previously indicated this domain ' +
                        'should always be accessed via HTTPS (HSTS Protocol). Chrome has cached this internally, ' +
                        'and did not connect to any server for this redirect. Chrome reports this redirect as a ' +
                        '"307 Internal Redirect" however this probably would have been a ' +
                        '"301 Permanent redirect" originally. You can verify this by clearing your browser cache and ' +
                        'visiting the original URL again. ';
                }
            });
        }
    },

    getHeaderString: function (pathItem) {
        var statusString = pathItem.status_code + ': ' + pathItem.status_line;

        if (pathItem.type == 'server_redirect') {
            var redirectType = 'Temporary';

            if (pathItem.status_code == 301 || pathItem.status_code == 308) {
                redirectType = 'Permanent';
            }

            if (pathItem.status_code == 307 && pathItem.headers) {
                pathItem.headers.forEach(function (header) {
                    if (header.name == 'Non-Authoritative-Reason' && header.value == 'HSTS') {
                        redirectType = 'Internal (browser cached)';
                    }
                });
            }

            statusString = pathItem.status_code + ': ' + redirectType + ' redirect to ' + pathItem.redirect_url;
        } else if (pathItem.status_code == 404) {
            statusString = pathItem.status_code + ': This page is NOT FOUND';
        } else if (pathItem.status_code == 503) {
            var retryAfter = '';
            if (typeof pathItem.headers != 'undefined' && pathItem.headers) {
                pathItem.headers.forEach(function (val) {
                    if (val.name == 'Retry-After') {
                        retryAfter = ' Retry after ' + val.value + ' seconds.';
                    }
                });
            }

            statusString = pathItem.status_code + ': Page temporarily unavailable.' + retryAfter;
        }

        if (pathItem.type == 'client_redirect') {
            statusString = pathItem.status_code + ' then ' + pathItem.redirect_type.toUpperCase() + ' redirect to ' + pathItem.redirect_url;
        }

        return statusString;
    },

    renderHeaders: function (pathItem, templateEl) {
        var ul = templateEl.querySelector('.pathResponseHeaders');
        var firstLi = ul.querySelector('li');
        var responseTemplate = firstLi.cloneNode(true);
        ul.innerHTML = '';

        var ipRow = responseTemplate.cloneNode(true);
        ipRow.querySelector('.responseKey').textContent = 'Server IP Address';
        ipRow.querySelector('.responseValue').textContent = pathItem.ip;
        ul.appendChild(ipRow);

        if (typeof pathItem.headers != 'undefined' && pathItem.headers) {
            pathItem.headers.forEach(function (val) {
                if (val.name != 'Set-Cookie') {
                    var row = responseTemplate.cloneNode(true);
                    row.querySelector('.responseKey').textContent = val.name;
                    row.querySelector('.responseValue').textContent = val.value;
                    ul.appendChild(row);
                }
            });
        }
    },

    renderPathIcon: function (pathItem, templateEl) {
        if (pathItem.type == 'client_redirect') {
            var redirectTypeIconString = pathItem.redirect_type.toUpperCase();

            if (pathItem.redirect_type == 'javascript') {
                redirectTypeIconString = 'JS';
            }

            var badgeClass = pathItem.redirect_type === 'javascript'
                ? 'javascriptRedirect'
                : pathItem.redirect_type === 'meta'
                    ? 'metaRedirect'
                    : pathItem.redirect_type + 'Redirect';

            var span = document.createElement('span');
            span.className = 'clientRedirectBadge ' + badgeClass;
            span.textContent = redirectTypeIconString;
            templateEl.querySelector('.pathIcon').appendChild(span);
        }
    },

    sendToAyima: function (e) {
        e.preventDefault();

        var self = this;
        var btn = document.querySelector('.send-to-ayima');
        var status = document.querySelector('.ayima-status');

        if (!self.currentTab || !self.currentTab.id) {
            status.textContent = 'No active tab available.';
            status.style.display = 'block';
            return;
        }

        btn.disabled = true;
        status.textContent = 'Sending to Ayima AI...';
        status.style.display = 'block';

        chrome.runtime.sendMessage({name: 'getTabPath', tabId: self.currentTab.id}, function (response) {
            if (!response || !response.path || response.path.length === 0) {
                status.textContent = 'No redirect data available.';
                btn.disabled = false;
                return;
            }

            var payload = {
                url: response.path[0].url,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString(),
                chain: response.path
            };

            fetch('https://ayima.ai/api/redirect-analysis', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            })
                .then(function (res) {
                    if (res.status === 429) {
                        throw new Error('rate-limit');
                    }
                    if (!res.ok) {
                        throw new Error('HTTP ' + res.status);
                    }
                    return res.json();
                })
                .then(function (data) {
                    if (!data || !data.url) {
                        throw new Error('No URL in response');
                    }
                    chrome.tabs.create({url: 'https://ayima.ai' + data.url});
                    window.close();
                })
                .catch(function (err) {
                    if (err.message === 'rate-limit') {
                        status.textContent = 'Too many requests. Please wait a minute and try again.';
                    } else {
                        status.textContent = 'Failed to send. Please try again.';
                    }
                    btn.disabled = false;
                });
        });
    },

    copyWithExecCommand: function (value) {
        try {
            var input = document.createElement('textarea');
            document.body.appendChild(input);
            input.value = value;
            input.focus();
            input.select();
            var copied = document.execCommand('copy');
            input.remove();
            return copied;
        }
        catch (err) {
            return false;
        }
    },

    showCopyFeedback: function (btn) {
        var self = this;
        clearTimeout(self.copyFeedbackTimers.hold);
        clearTimeout(self.copyFeedbackTimers.reset);

        var defaultLabel = btn.getAttribute('data-default-label') || btn.textContent;
        if (!btn.getAttribute('data-default-label')) {
            btn.setAttribute('data-default-label', defaultLabel);
        }

        btn.textContent = 'Copied!';
        btn.classList.add('copied-state');

        self.copyFeedbackTimers.hold = setTimeout(function () {
            btn.classList.remove('copied-state');

            self.copyFeedbackTimers.reset = setTimeout(function () {
                btn.textContent = btn.getAttribute('data-default-label') || 'Copy to Clipboard';
            }, 1000);
        }, 3000);
    }
};

RedirectPathPopup.init();
