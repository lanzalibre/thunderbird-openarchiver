(function () {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const toggleFilters = document.getElementById('toggleFilters');
  const filterBody = document.getElementById('filterBody');
  const filterFrom = document.getElementById('filterFrom');
  const filterTo = document.getElementById('filterTo');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');
  const resultsEl = document.getElementById('results');
  const statusBar = document.getElementById('statusBar');
  const pagination = document.getElementById('pagination');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');

  let currentQuery = {};
  let currentPage = 1;
  let totalPages = 1;

  toggleFilters.addEventListener('click', () => {
    const hidden = filterBody.hidden;
    filterBody.hidden = !hidden;
    toggleFilters.textContent = hidden ? 'Filters ▴' : 'Filters ▾';
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  searchBtn.addEventListener('click', doSearch);

  prevPage.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      doSearch(false);
    }
  });

  nextPage.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      doSearch(false);
    }
  });

  function showStatus(message, type) {
    statusBar.textContent = message;
    statusBar.className = 'status-bar ' + type;
    statusBar.hidden = false;
  }

  function hideStatus() {
    statusBar.hidden = true;
  }

  async function doSearch(resetPage = true) {
    if (resetPage) currentPage = 1;

    const keywords = searchInput.value.trim();
    const from = filterFrom.value.trim();
    const to = filterTo.value.trim();
    const dateFrom = filterDateFrom.value;
    const dateTo = filterDateTo.value;

    if (!keywords && !from && !to && !dateFrom && !dateTo) {
      showStatus('Enter a search query or filter criteria', 'info');
      return;
    }

    const params = { keywords: keywords || undefined, page: currentPage };
    if (from) params.from = from;
    if (to) params.to = to;
    if (dateFrom) params.dateFrom = new Date(dateFrom).getTime() / 1000;
    if (dateTo) params.dateTo = new Date(dateTo + 'T23:59:59').getTime() / 1000;

    currentQuery = params;
    showStatus('Searching...', 'info');
    resultsEl.innerHTML = '';
    pagination.hidden = true;

    try {
      const response = await browser.runtime.sendMessage({
        action: 'search',
        params,
      });

      if (response.error) {
        showStatus(response.error, 'error');
        return;
      }

      const norm = normalizeSearchResults(response.results);
      renderResults(norm);
      hideStatus();
    } catch (err) {
      showStatus(getUserFriendlyMessage(err) || 'Search failed', 'error');
    }
  }

  function renderResults(normalized) {
    resultsEl.innerHTML = '';

    if (normalized.results.length === 0) {
      resultsEl.innerHTML = '<div class="empty">No results found.</div>';
      pagination.hidden = true;
      return;
    }

    for (const hit of normalized.results) {
      const card = document.createElement('div');
      card.className = 'result-card';

      const date = hit.date
        ? new Date(hit.date).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
          })
        : '';

      const attachBadge = hit.hasAttachments
        ? '<span class="badge" title="Has attachments">📎</span>'
        : '';

      card.innerHTML = `
        <div class="result-subject">${escapeHtml(hit.subject)} ${attachBadge}</div>
        <div class="result-meta">
          <span class="result-from">${escapeHtml(hit.from)}</span>
          <span class="result-date">${date}</span>
        </div>
        <div class="result-snippet">${escapeHtml(hit.snippet)}</div>
      `;

      card.addEventListener('click', async () => {
        const settings = await browser.runtime.sendMessage({ action: 'getSettings' });
        if (settings.frontendBaseUrl) {
          const url = buildMessageUrl(settings.frontendBaseUrl, hit.id);
          browser.tabs.create({ url });
        } else {
          showStatus('Web UI URL not configured in preferences', 'error');
        }
      });

      resultsEl.appendChild(card);
    }

    totalPages = normalized.totalPages;
    currentPage = normalized.page;
    updatePagination();
  }

  function updatePagination() {
    pagination.hidden = false;
    prevPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= totalPages;
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      searchInput.focus();
      e.preventDefault();
    }
  });
})();
