'use strict';

(() => {
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
  const $ = (id) => document.getElementById(id);

  const state = {
    token: null,
    tokenExpiresAt: 0,
    tokenClient: null,
    profile: null,
    messages: [],
    selected: new Set(),
    labels: [],
    senders: [],
    currentQuery: 'in:inbox',
    currentTitle: 'Inbox',
    nextPageToken: null,
    pageTokenHistory: [null],
    currentMessage: null,
    busy: false,
  };

  const clientIdFromConfig = window.GMAIL_MANAGER_CONFIG?.googleClientId || '';
  const savedClientId = localStorage.getItem('gmailManagerClientId') || '';
  const initialClientId = savedClientId || clientIdFromConfig;
  $('clientIdInput').value = initialClientId;

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function notify(message, duration = 3600) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => toast.classList.remove('show'), duration);
  }

  function setBusy(value, message = '') {
    state.busy = value;
    document.body.classList.toggle('busy', value);
    if (message) notify(message, value ? 6000 : 2500);
  }

  function currentClientId() {
    return ($('clientIdInput').value || $('settingsClientId').value || '').trim();
  }

  function getTokenClient() {
    const clientId = currentClientId() || initialClientId;
    if (!clientId) throw new Error('Enter your Google OAuth Client ID first.');
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      throw new Error('That does not look like a Google OAuth Client ID.');
    }
    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services has not loaded. Check your internet connection and reload this page.');
    }
    state.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      include_granted_scopes: true,
      callback: handleTokenResponse,
      error_callback: (error) => {
        $('connectError').textContent = error?.message || 'Google sign-in could not be completed.';
      },
    });
    return state.tokenClient;
  }

  function connect() {
    try {
      const id = currentClientId() || initialClientId;
      if (!id) {
        $('connectError').textContent = 'Enter your Google OAuth Client ID to continue.';
        $('clientIdInput').focus();
        return;
      }
      localStorage.setItem('gmailManagerClientId', id);
      $('connectError').textContent = '';
      const client = getTokenClient();
      client.requestAccessToken({ prompt: state.token ? '' : 'consent' });
    } catch (error) {
      $('connectError').textContent = error.message;
      notify(error.message, 5000);
    }
  }

  async function handleTokenResponse(response) {
    if (response?.error) {
      $('connectError').textContent = response.error_description || response.error;
      notify('Google authorization failed: ' + response.error, 5000);
      return;
    }
    if (!response?.access_token) {
      $('connectError').textContent = 'Google did not return an access token.';
      return;
    }
    state.token = response.access_token;
    state.tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
    // Token is intentionally held in memory only. It is not written to localStorage.
    $('connectPanel').hidden = true;
    $('workspace').hidden = false;
    $('connectButton').hidden = true;
    $('disconnectButton').hidden = false;
    $('refreshButton').disabled = false;
    $('composeButton').disabled = false;
    $('createLabelButton').disabled = false;
    $('scanSendersButton').disabled = false;
    $('senderScanButton').disabled = false;
    $('connectError').textContent = '';
    setBusy(true, 'Connected. Loading your mailbox…');
    try {
      await loadProfile();
      await loadLabels();
      await loadMessages(state.currentQuery, null);
      notify('Connected to Gmail.');
    } catch (error) {
      handleApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function api(path, options = {}) {
    if (!state.token) throw new Error('Connect your Google account first.');
    if (state.tokenExpiresAt && Date.now() > state.tokenExpiresAt - 30000) {
      state.token = null;
      throw new Error('Your Google access token has expired. Click Connect Google to reconnect.');
    }
    const response = await fetch(`${API}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(options.body ? {'Content-Type': 'application/json'} : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {error: {message: text}}; }
    if (!response.ok) {
      const message = data?.error?.message || `Gmail API request failed (${response.status}).`;
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function handleApiError(error) {
    console.error(error);
    if (error.status === 401 || /token has expired/i.test(error.message)) {
      state.token = null;
      $('connectButton').hidden = false;
      $('disconnectButton').hidden = true;
    }
    notify(error.message || 'Something went wrong.', 6000);
  }

  async function loadProfile() {
    state.profile = await api('/profile');
    const email = state.profile.emailAddress || 'Google account';
    $('accountName').textContent = email.split('@')[0] || 'Connected';
    $('accountEmail').textContent = email;
    $('accountAvatar').textContent = (email[0] || 'G').toUpperCase();
    $('connectionDot').classList.add('connected');
    $('statTotal').textContent = number(state.profile.messagesTotal);
    $('statThreads').textContent = number(state.profile.threadsTotal);
    $('statUnread').textContent = '—';
  }

  async function loadLabels() {
    const response = await api('/labels');
    state.labels = response.labels || [];
    renderLabels();
  }

  function renderLabels() {
    const custom = state.labels.filter(label => label.type === 'user');
    $('labelNav').innerHTML = custom.length ? custom.map(label => `
      <button class="nav-item" data-label-id="${escapeHtml(label.id)}" data-label-name="${escapeHtml(label.name)}"><span class="label-color"></span>${escapeHtml(label.name)}</button>`).join('') : '<div class="muted-mini">No custom labels yet</div>';
    const options = custom.map(label => `<option value="${escapeHtml(label.id)}">${escapeHtml(label.name)}</option>`).join('');
    $('labelActionSelect').innerHTML = '<option value="">Label as…</option>' + options;
  }

  function number(value) {
    return Number(value || 0).toLocaleString();
  }

  function shouldIncludeSpamTrash(query) {
    return /(?:^|\s)in:(?:spam|trash|anywhere)(?:\s|$)/i.test(query || '');
  }

  async function listMessages(query, pageToken = null, maxResults = 50) {
    const params = new URLSearchParams();
    params.set('maxResults', String(Math.min(500, Math.max(1, maxResults))));
    if (query) params.set('q', query);
    if (pageToken) params.set('pageToken', pageToken);
    if (shouldIncludeSpamTrash(query)) params.set('includeSpamTrash', 'true');
    return api(`/messages?${params.toString()}`);
  }

  async function mapLimit(items, limit, mapper) {
    const output = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        output[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return output;
  }

  async function getMessageMetadata(id) {
    const data = await api(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
    const headers = data.payload?.headers || [];
    const header = (name) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    return {
      id: data.id,
      threadId: data.threadId,
      from: header('From') || 'Unknown sender',
      to: header('To'),
      subject: header('Subject') || '(No subject)',
      date: header('Date'),
      snippet: data.snippet || '',
      labelIds: data.labelIds || [],
      unread: (data.labelIds || []).includes('UNREAD'),
      starred: (data.labelIds || []).includes('STARRED'),
    };
  }

  async function loadMessages(query = state.currentQuery, pageToken = null) {
    setBusy(true);
    try {
      state.currentQuery = query;
      $('searchInput').value = query;
      const response = await listMessages(query, pageToken, Number($('pageSize').value));
      const ids = response.messages || [];
      state.messages = await mapLimit(ids, 8, item => getMessageMetadata(item.id));
      state.nextPageToken = response.nextPageToken || null;
      state.selected.clear();
      renderMessages();
      updateNavigation(query);
      $('resultDescription').textContent = `${number(response.resultSizeEstimate)} matching messages (estimated)`;
      $('pageStatus').textContent = state.messages.length ? `Showing ${state.messages.length} messages` : 'No messages found';
      $('previousPageButton').disabled = state.pageTokenHistory.length <= 1;
      $('nextPageButton').disabled = !state.nextPageToken;
      $('bulkToolbar').style.opacity = '1';
      $('selectAllCheckbox').checked = false;
      updateSelectedCount();
      const unreadOnPage = state.messages.filter(m => m.unread).length;
      $('statUnread').textContent = number(unreadOnPage);
    } finally {
      setBusy(false);
    }
  }

  function updateNavigation(query) {
    document.querySelectorAll('.nav-item[data-query]').forEach(button => {
      button.classList.toggle('active', button.dataset.query === query);
    });
    $('pageTitle').textContent = state.currentTitle;
    $('listHeading').textContent = state.currentTitle;
    $('pageSubtitle').textContent = query ? `Gmail search: ${query}` : 'All matching messages';
    $('trashMatchingButton').title = `Move all messages matching “${query}” to Trash`;
    document.querySelector('[data-action="restore"]')?.toggleAttribute('hidden', !/in:trash/.test(query));
  }

  function renderMessages() {
    if (!state.messages.length) {
      $('mailList').innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div><strong>No messages found</strong><p>Try changing your search or selecting another mailbox.</p></div>';
      return;
    }
    $('mailList').innerHTML = state.messages.map(message => {
      const sender = senderName(message.from);
      const date = shortDate(message.date);
      return `<article class="mail-row ${message.unread ? 'unread' : ''}" data-open-message="${escapeHtml(message.id)}">
        <label class="row-check" title="Select message"><input type="checkbox" data-select-message="${escapeHtml(message.id)}" ${state.selected.has(message.id) ? 'checked' : ''}></label>
        <div class="row-main"><div class="row-top"><span class="row-sender">${escapeHtml(sender)}</span><span class="row-subject">${message.starred ? '<span class="row-star">★</span>' : ''}${escapeHtml(message.subject)}</span></div><div class="row-snippet">${escapeHtml(message.snippet)}</div></div>
        <div class="row-date">${escapeHtml(date)}</div>
      </article>`;
    }).join('');
  }

  function senderName(from) {
    const angle = from.match(/^\s*(.*?)\s*<([^>]+)>/);
    if (angle) return angle[1].replace(/^"|"$/g, '') || angle[2];
    return from;
  }

  function senderEmail(from) {
    const match = from.match(/<([^>]+)>/);
    if (match) return match[1].trim().toLowerCase();
    const email = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return email ? email[0].toLowerCase() : from.toLowerCase();
  }

  function shortDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 16);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], {month:'short', day:'numeric'});
    return date.toLocaleDateString([], {year:'2-digit', month:'short', day:'numeric'});
  }

  function updateSelectedCount() {
    $('selectedCount').textContent = `${state.selected.size} selected`;
    $('bulkToolbar').classList.toggle('has-selection', state.selected.size > 0);
    $('selectAllCheckbox').checked = state.messages.length > 0 && state.messages.every(m => state.selected.has(m.id));
  }

  async function openMessage(id) {
    setBusy(true);
    try {
      const data = await api(`/messages/${encodeURIComponent(id)}?format=full`);
      state.currentMessage = data;
      const headers = data.payload?.headers || [];
      const header = (name) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      $('messageSubject').textContent = header('Subject') || '(No subject)';
      $('messageFrom').textContent = header('From') || 'Unknown sender';
      $('messageTo').textContent = `To: ${header('To') || '—'}`;
      $('messageDate').textContent = header('Date');
      $('messageAvatar').textContent = (senderName(header('From') || '?')[0] || '?').toUpperCase();
      $('messageLabels').innerHTML = (data.labelIds || []).map(id => {
        const label = state.labels.find(l => l.id === id);
        return `<span class="label-pill">${escapeHtml(label?.name || id)}</span>`;
      }).join('');
      const extracted = extractBody(data.payload);
      $('messageBody').textContent = extracted.text || data.snippet || '(This message has no readable text content.)';
      renderAttachments(data);
      $('messageStarButton').textContent = (data.labelIds || []).includes('STARRED') ? '★' : '☆';
      $('messageUnreadButton').title = (data.labelIds || []).includes('UNREAD') ? 'Mark read' : 'Mark unread';
      $('messageModal').hidden = false;
      document.body.style.overflow = 'hidden';
      if ((data.labelIds || []).includes('UNREAD')) {
        await modifyMessages([id], [], ['UNREAD']);
        const item = state.messages.find(m => m.id === id);
        if (item) item.unread = false;
        renderMessages();
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setBusy(false);
    }
  }

  function decodeBase64Url(value) {
    if (!value) return '';
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    try { return new TextDecoder('utf-8').decode(bytes); }
    catch (_) { return binary; }
  }

  function walkParts(part, results) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) results.plain.push(decodeBase64Url(part.body.data));
    if (part.mimeType === 'text/html' && part.body?.data) results.html.push(decodeBase64Url(part.body.data));
    if (part.parts) part.parts.forEach(child => walkParts(child, results));
  }

  function extractBody(payload) {
    const results = {plain: [], html: []};
    walkParts(payload, results);
    if (results.plain.length) return {text: results.plain.join('\n\n')};
    if (results.html.length) {
      const doc = new DOMParser().parseFromString(results.html.join('\n'), 'text/html');
      doc.querySelectorAll('script,style,noscript,iframe,object,embed').forEach(node => node.remove());
      return {text: (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()};
    }
    if (payload?.body?.data) return {text: decodeBase64Url(payload.body.data)};
    return {text: ''};
  }

  function collectAttachments(part, output = []) {
    if (!part) return output;
    if (part.filename && part.body?.attachmentId) {
      output.push({filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType || 'application/octet-stream', size: part.body.size || 0});
    }
    (part.parts || []).forEach(child => collectAttachments(child, output));
    return output;
  }

  function renderAttachments(message) {
    const attachments = collectAttachments(message.payload);
    $('attachmentArea').innerHTML = attachments.map((attachment, index) => `<button class="attachment-chip" data-download-attachment="${index}">↓ ${escapeHtml(attachment.filename)}${attachment.size ? ` · ${formatBytes(attachment.size)}` : ''}</button>`).join('');
    $('attachmentArea').dataset.attachments = JSON.stringify(attachments);
    $('attachmentArea').dataset.messageId = message.id;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function downloadAttachment(index) {
    try {
      const attachments = JSON.parse($('attachmentArea').dataset.attachments || '[]');
      const item = attachments[index];
      const messageId = $('attachmentArea').dataset.messageId;
      if (!item || !messageId) return;
      const data = await api(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(item.attachmentId)}`);
      const encoded = data.data.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)), c => c.charCodeAt(0));
      const blob = new Blob([bytes], {type: item.mimeType});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { handleApiError(error); }
  }

  async function modifyMessages(ids, addLabelIds = [], removeLabelIds = []) {
    if (!ids.length) return;
    for (let start = 0; start < ids.length; start += 1000) {
      await api('/messages/batchModify', {
        method: 'POST',
        body: {ids: ids.slice(start, start + 1000), addLabelIds, removeLabelIds},
      });
    }
  }

  async function applyBulkAction(action) {
    const ids = [...state.selected];
    if (!ids.length) return notify('Select one or more messages first.');
    let add = [], remove = [], label = '';
    if (action === 'archive') remove = ['INBOX'];
    if (action === 'read') remove = ['UNREAD'];
    if (action === 'unread') add = ['UNREAD'];
    if (action === 'star') add = ['STARRED'];
    if (action === 'unstar') remove = ['STARRED'];
    if (action === 'spam') { add = ['SPAM']; remove = ['INBOX']; }
    if (action === 'trash') { add = ['TRASH']; remove = ['INBOX']; }
    if (action === 'restore') remove = ['TRASH'];
    if (action === 'label') {
      label = $('labelActionSelect').value;
      if (!label) return notify('Choose a label first.');
      add = [label];
    }
    const actionNames = {archive:'archive',read:'mark as read',unread:'mark as unread',star:'star',unstar:'unstar',spam:'mark as spam',trash:'move to Trash',restore:'restore',label:'apply label to'};
    if (action === 'trash' && !confirm(`Move ${ids.length} selected message(s) to Gmail Trash?`)) return;
    setBusy(true, `Updating ${ids.length} selected messages…`);
    try {
      await modifyMessages(ids, add, remove);
      state.selected.clear();
      notify(`Successfully updated ${ids.length} message(s).`);
      await loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null);
    } catch (error) { handleApiError(error); }
    finally { setBusy(false); }
  }

  async function trashAllMatching() {
    const query = $('searchInput').value.trim();
    if (!query) return notify('Enter a Gmail search query first.');
    if (/\bin:(?:trash|spam|anywhere)\b/i.test(query)) return notify('For safety, bulk move-to-Trash is disabled for Spam, Trash and in:anywhere searches. Remove that operator and try again.');
    if (!confirm(`Count all messages matching:\n\n${query}\n\nContinue to count them before moving anything to Trash?`)) return;
    setBusy(true, 'Counting every matching message…');
    try {
      let pageToken = null, total = 0;
      do {
        const page = await listMessages(query, pageToken, 500);
        total += (page.messages || []).length;
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      if (!total) { notify('No matching messages found.'); return; }
      const confirmation = prompt(`Found ${total.toLocaleString()} matching messages.\n\nType TRASH to move all of them to Gmail Trash.`, '');
      if (confirmation !== 'TRASH') { notify('Bulk action cancelled.'); return; }
      let moved = 0;
      while (true) {
        const page = await listMessages(query, null, 500);
        const ids = (page.messages || []).map(item => item.id);
        if (!ids.length) break;
        await modifyMessages(ids, ['TRASH'], ['INBOX']);
        moved += ids.length;
        notify(`Moved ${moved.toLocaleString()} of ${total.toLocaleString()} messages…`, 2500);
      }
      state.pageTokenHistory = [null];
      notify(`Finished. ${moved.toLocaleString()} message(s) moved to Trash.`, 5000);
      await loadMessages(query, null);
    } catch (error) { handleApiError(error); }
    finally { setBusy(false); }
  }

  async function scanSenders() {
    const maxMessages = Number($('scanLimit').value);
    $('scanProgress').hidden = false;
    $('scanProgressBar').style.width = '0%';
    $('scanProgressText').textContent = 'Preparing mailbox scan…';
    $('scanSendersButton').disabled = true;
    $('senderScanButton').disabled = true;
    const totals = new Map();
    let pageToken = null, scanned = 0;
    try {
      do {
        const page = await listMessages('-in:spam -in:trash -in:sent -in:drafts', pageToken, Math.min(500, maxMessages - scanned));
        const ids = page.messages || [];
        if (!ids.length) break;
        const records = await mapLimit(ids, 10, async item => {
          try { return await getMessageMetadata(item.id); }
          catch (_) { return null; }
        });
        for (const record of records) {
          if (!record?.from) continue;
          const email = senderEmail(record.from);
          const name = senderName(record.from);
          const current = totals.get(email) || {email, name, count: 0};
          current.count++;
          if (!current.name || current.name === current.email) current.name = name;
          totals.set(email, current);
        }
        scanned += ids.length;
        pageToken = page.nextPageToken || null;
        const percent = Math.min(100, Math.round((scanned / maxMessages) * 100));
        $('scanProgressBar').style.width = `${percent}%`;
        $('scanProgressText').textContent = `Scanned ${scanned.toLocaleString()} messages…`;
        $('statSenders').textContent = number(totals.size);
        if (scanned >= maxMessages) break;
      } while (pageToken);
      state.senders = [...totals.values()].sort((a,b) => b.count - a.count);
      renderSenders();
      $('statSenders').textContent = number(state.senders.length);
      $('senderScanNote').textContent = `${number(scanned)} messages scanned`;
      $('exportSendersButton').disabled = !state.senders.length;
      $('scanProgressText').textContent = `Finished: ${scanned.toLocaleString()} messages, ${state.senders.length.toLocaleString()} unique senders.`;
      notify(`Sender scan complete: ${state.senders.length} unique senders.`);
    } catch (error) { handleApiError(error); }
    finally { $('scanSendersButton').disabled = false; $('senderScanButton').disabled = false; }
  }

  function renderSenders() {
    if (!state.senders.length) {
      $('senderList').innerHTML = '<div class="sender-placeholder">No sender addresses were found in the scanned messages.</div>';
      return;
    }
    $('senderList').innerHTML = state.senders.slice(0, 20).map(sender => `
      <div class="sender-row" data-sender-search="${escapeHtml(sender.email)}" title="Search emails from ${escapeHtml(sender.email)}">
        <div class="sender-avatar">${escapeHtml((sender.name || sender.email)[0]?.toUpperCase() || '?')}</div>
        <div class="sender-details"><div class="sender-name">${escapeHtml(sender.name || sender.email)}</div><div class="sender-address">${escapeHtml(sender.email)}</div></div>
        <span class="sender-count">${number(sender.count)}</span>
      </div>`).join('');
  }

  function exportSenders() {
    if (!state.senders.length) return;
    const rows = [['Name','Email','Messages'], ...state.senders.map(s => [s.name, s.email, s.count])];
    const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadText(csv, 'gmail-senders.csv', 'text/csv;charset=utf-8');
  }

  function downloadText(text, filename, type) {
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function rawMessage(to, cc, subject, body) {
    const safe = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const headers = [`To: ${safe(to)}`];
    if (cc) headers.push(`Cc: ${safe(cc)}`);
    headers.push(`Subject: ${safe(subject)}`);
    headers.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit');
    const mime = headers.join('\r\n') + '\r\n\r\n' + String(body || '').replace(/\r?\n/g, '\r\n');
    const bytes = new TextEncoder().encode(mime);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sendMessage(event) {
    event.preventDefault();
    const to = $('composeTo').value.trim();
    const cc = $('composeCc').value.trim();
    const subject = $('composeSubject').value.trim();
    const body = $('composeBody').value;
    if (!to || !body.trim()) return notify('Add a recipient and message body.');
    $('sendButton').disabled = true;
    $('composeStatus').textContent = 'Sending…';
    try {
      await api('/messages/send', {method:'POST', body:{raw:rawMessage(to, cc, subject, body)}});
      $('composeForm').reset();
      $('composeModal').hidden = true;
      document.body.style.overflow = '';
      notify('Message sent.');
    } catch (error) { $('composeStatus').textContent = error.message; handleApiError(error); }
    finally { $('sendButton').disabled = false; }
  }

  async function createLabel() {
    const name = prompt('Name for the new Gmail label:');
    if (!name?.trim()) return;
    try {
      await api('/labels', {method:'POST', body:{name:name.trim()}});
      await loadLabels();
      notify(`Label “${name.trim()}” created.`);
    } catch (error) { handleApiError(error); }
  }

  async function disconnect(revoke = false) {
    const token = state.token;
    if (revoke && token && window.google?.accounts?.oauth2) {
      await new Promise(resolve => window.google.accounts.oauth2.revoke(token, resolve));
    }
    state.token = null;
    state.profile = null;
    state.messages = [];
    state.selected.clear();
    state.senders = [];
    $('workspace').hidden = true;
    $('connectPanel').hidden = false;
    $('connectButton').hidden = false;
    $('disconnectButton').hidden = true;
    $('refreshButton').disabled = true;
    $('composeButton').disabled = true;
    $('createLabelButton').disabled = true;
    $('scanSendersButton').disabled = true;
    $('senderScanButton').disabled = true;
    $('accountName').textContent = 'Not connected';
    $('accountEmail').textContent = 'Connect a Google account';
    $('accountAvatar').textContent = 'G';
    $('connectionDot').classList.remove('connected');
    $('mailList').innerHTML = '';
    $('senderList').innerHTML = '<div class="sender-placeholder">Run a scan to see people and services ranked by email volume.</div>';
    $('statTotal').textContent = '—'; $('statUnread').textContent = '—'; $('statThreads').textContent = '—'; $('statSenders').textContent = '—';
    $('exportSendersButton').disabled = true;
    $('labelNav').innerHTML = '<div class="muted-mini">Connect to load labels</div>';
    if (revoke) notify('Google access revoked.');
    else notify('Disconnected.');
  }

  // ---------- UI events ----------
  $('connectButton').addEventListener('click', connect);
  $('connectStartButton').addEventListener('click', connect);
  $('clientIdInput').addEventListener('keydown', event => { if (event.key === 'Enter') connect(); });
  $('disconnectButton').addEventListener('click', () => disconnect(false));
  $('refreshButton').addEventListener('click', () => loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null).catch(handleApiError));
  $('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('searchInput').value.trim();
    state.currentTitle = query || 'All Mail';
    state.pageTokenHistory = [null];
    loadMessages(query, null).catch(handleApiError);
  });
  $('pageSize').addEventListener('change', () => { state.pageTokenHistory = [null]; loadMessages(state.currentQuery, null).catch(handleApiError); });
  document.querySelectorAll('.quick-filters button').forEach(button => button.addEventListener('click', () => {
    const query = button.dataset.search;
    state.currentTitle = button.textContent;
    state.pageTokenHistory = [null];
    loadMessages(query, null).catch(handleApiError);
  }));
  document.querySelectorAll('.nav-item[data-query]').forEach(button => button.addEventListener('click', () => {
    state.currentTitle = button.dataset.title;
    state.pageTokenHistory = [null];
    loadMessages(button.dataset.query, null).catch(handleApiError);
  }));
  $('labelNav').addEventListener('click', event => {
    const button = event.target.closest('[data-label-id]');
    if (!button) return;
    state.currentTitle = button.dataset.labelName;
    state.pageTokenHistory = [null];
    loadMessages(`label:"${button.dataset.labelName.replace(/\"/g, '')}"`, null).catch(handleApiError);
  });
  $('mailList').addEventListener('click', event => {
    if (event.target.matches('input[data-select-message]')) return;
    const row = event.target.closest('[data-open-message]');
    if (row) openMessage(row.dataset.openMessage);
  });
  $('mailList').addEventListener('change', event => {
    const checkbox = event.target.closest('input[data-select-message]');
    if (!checkbox) return;
    if (checkbox.checked) state.selected.add(checkbox.dataset.selectMessage);
    else state.selected.delete(checkbox.dataset.selectMessage);
    updateSelectedCount();
  });
  $('selectAllCheckbox').addEventListener('change', event => {
    if (event.target.checked) state.messages.forEach(m => state.selected.add(m.id));
    else state.messages.forEach(m => state.selected.delete(m.id));
    renderMessages(); updateSelectedCount();
  });
  $('bulkToolbar').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) applyBulkAction(button.dataset.action);
  });
  $('applyLabelButton').addEventListener('click', () => applyBulkAction('label'));
  $('trashMatchingButton').addEventListener('click', trashAllMatching);
  $('scanSendersButton').addEventListener('click', scanSenders);
  $('senderScanButton').addEventListener('click', scanSenders);
  $('exportSendersButton').addEventListener('click', exportSenders);
  $('senderList').addEventListener('click', event => {
    const row = event.target.closest('[data-sender-search]');
    if (!row) return;
    const query = `from:${row.dataset.senderSearch}`;
    state.currentTitle = `From ${row.dataset.senderSearch}`;
    state.pageTokenHistory = [null];
    loadMessages(query, null).catch(handleApiError);
  });
  $('previousPageButton').addEventListener('click', () => {
    if (state.pageTokenHistory.length <= 1) return;
    state.pageTokenHistory.pop();
    const token = state.pageTokenHistory[state.pageTokenHistory.length - 1] || null;
    loadMessages(state.currentQuery, token).catch(handleApiError);
  });
  $('nextPageButton').addEventListener('click', () => {
    if (!state.nextPageToken) return;
    state.pageTokenHistory.push(state.nextPageToken);
    loadMessages(state.currentQuery, state.nextPageToken).catch(handleApiError);
  });
  $('closeMessageButton').addEventListener('click', () => { $('messageModal').hidden = true; document.body.style.overflow = ''; });
  $('messageModal').addEventListener('click', event => { if (event.target === $('messageModal')) { $('messageModal').hidden = true; document.body.style.overflow = ''; } });
  $('attachmentArea').addEventListener('click', event => {
    const button = event.target.closest('[data-download-attachment]');
    if (button) downloadAttachment(Number(button.dataset.downloadAttachment));
  });
  $('messageArchiveButton').addEventListener('click', async () => {
    if (!state.currentMessage) return;
    try { await modifyMessages([state.currentMessage.id], [], ['INBOX']); $('messageModal').hidden = true; await loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null); }
    catch (error) { handleApiError(error); }
  });
  $('messageTrashButton').addEventListener('click', async () => {
    if (!state.currentMessage || !confirm('Move this message to Gmail Trash?')) return;
    try { await modifyMessages([state.currentMessage.id], ['TRASH'], ['INBOX']); $('messageModal').hidden = true; await loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null); }
    catch (error) { handleApiError(error); }
  });
  $('messageStarButton').addEventListener('click', async () => {
    if (!state.currentMessage) return;
    const starred = (state.currentMessage.labelIds || []).includes('STARRED');
    try { await modifyMessages([state.currentMessage.id], starred ? [] : ['STARRED'], starred ? ['STARRED'] : []); state.currentMessage.labelIds = starred ? state.currentMessage.labelIds.filter(x => x !== 'STARRED') : [...state.currentMessage.labelIds, 'STARRED']; $('messageStarButton').textContent = starred ? '☆' : '★'; await loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null); }
    catch (error) { handleApiError(error); }
  });
  $('messageUnreadButton').addEventListener('click', async () => {
    if (!state.currentMessage) return;
    const unread = (state.currentMessage.labelIds || []).includes('UNREAD');
    try { await modifyMessages([state.currentMessage.id], unread ? [] : ['UNREAD'], unread ? ['UNREAD'] : []); $('messageModal').hidden = true; await loadMessages(state.currentQuery, state.pageTokenHistory.at(-1) || null); }
    catch (error) { handleApiError(error); }
  });
  $('composeButton').addEventListener('click', () => { $('composeModal').hidden = false; $('composeTo').focus(); document.body.style.overflow = 'hidden'; });
  $('closeComposeButton').addEventListener('click', () => { $('composeModal').hidden = true; document.body.style.overflow = ''; });
  $('composeModal').addEventListener('click', event => { if (event.target === $('composeModal')) { $('composeModal').hidden = true; document.body.style.overflow = ''; } });
  $('composeForm').addEventListener('submit', sendMessage);
  $('createLabelButton').addEventListener('click', createLabel);
  $('settingsButton').addEventListener('click', () => {
    $('settingsClientId').value = currentClientId() || initialClientId;
    $('settingsModal').hidden = false;
  });
  $('closeSettingsButton').addEventListener('click', () => $('settingsModal').hidden = true);
  $('settingsModal').addEventListener('click', event => { if (event.target === $('settingsModal')) $('settingsModal').hidden = true; });
  $('saveClientIdButton').addEventListener('click', () => {
    const id = $('settingsClientId').value.trim();
    if (id && !id.endsWith('.apps.googleusercontent.com')) return notify('Enter a valid Google OAuth Client ID.');
    localStorage.setItem('gmailManagerClientId', id);
    $('clientIdInput').value = id;
    $('settingsModal').hidden = true;
    notify('OAuth Client ID saved in this browser. Reconnect to use it.');
  });
  $('revokeButton').addEventListener('click', async () => {
    if (!confirm('Revoke this app’s Google access? You will need to authorize it again to reconnect.')) return;
    $('settingsModal').hidden = true;
    await disconnect(true);
  });

  // A small hint for local static hosting and for browsers where GIS is blocked.
  window.addEventListener('load', () => {
    if (initialClientId) $('clientIdInput').value = initialClientId;
  });
})();
