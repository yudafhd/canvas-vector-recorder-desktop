import { invoke } from '@tauri-apps/api/core';

const SEEN_KEY = 'canvas-vector-recorder-discover-seen-v1';
const REFRESH_MS = 3 * 60 * 60 * 1000;

interface DiscoverItem {
  id: string;
  type: string;
  title: string;
  description: string;
  imageUrl: string | null;
  link: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function parseItems(raw: unknown): DiscoverItem[] {
  if (!raw || typeof raw !== 'object' || !('success' in raw) || raw.success !== true || !('data' in raw) || !Array.isArray(raw.data)) {
    throw new Error('Format data Discover tidak sesuai.');
  }
  const seen = new Set<string>();
  const items: DiscoverItem[] = [];
  for (const entry of raw.data) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.title !== 'string' || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push({
      id: entry.id,
      type: typeof entry.type === 'string' ? entry.type : 'note',
      title: entry.title,
      description: typeof entry.description === 'string' ? entry.description : '',
      imageUrl: httpsUrl(entry.image_url),
      link: httpsUrl(entry.link),
      note: typeof entry.note === 'string' ? entry.note : null,
      sortOrder: typeof entry.sort_order === 'number' ? entry.sort_order : Number.MAX_SAFE_INTEGER,
      createdAt: typeof entry.created_at === 'string' ? entry.created_at : '',
    });
  }
  return items.sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt));
}

function readSeenIds(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch { return new Set(); }
}

function message(text: string, className = 'discover-message'): HTMLElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export function initDiscover(onNewItems: (count: number) => void): { setEnabled: (enabled: boolean) => void } {
  const button = document.getElementById('discoverButton') as HTMLButtonElement;
  const badge = document.getElementById('discoverBadge') as HTMLElement;
  const overlay = document.getElementById('discoverOverlay') as HTMLElement;
  const content = document.getElementById('discoverContent') as HTMLElement;
  const refreshButton = document.getElementById('refreshDiscover') as HTMLButtonElement;
  const closeButton = document.getElementById('closeDiscover') as HTMLButtonElement;
  let enabled = false;
  let loading = false;
  let requestId = 0;
  let timer: number | null = null;
  let items: DiscoverItem[] = [];
  let error: string | null = null;
  const seenIds = readSeenIds();
  const announcedIds = new Set<string>();
  const sheetUnreadIds = new Set<string>();

  function updateBadge(): void {
    const count = items.filter(item => !seenIds.has(item.id)).length;
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    const label = count ? `Buka Discover, ${count} kabar baru` : 'Buka Discover';
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function markSeen(): void {
    let changed = false;
    for (const item of items) {
      if (!seenIds.has(item.id)) { seenIds.add(item.id); changed = true; }
    }
    if (changed) {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds])); } catch { /* Penyimpanan lokal boleh tidak tersedia. */ }
      updateBadge();
    }
  }

  function render(): void {
    content.replaceChildren();
    refreshButton.disabled = loading;
    if (error) {
      const notice = document.createElement('div');
      notice.className = 'discover-error';
      notice.append(message(error));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Coba lagi';
      retry.addEventListener('click', () => { void refresh(); });
      notice.append(retry);
      content.append(notice);
    }
    if (loading && !items.length) content.append(message('Memuat kabar...'));
    else if (!items.length && !error) content.append(message('Belum ada kabar untuk ditampilkan.'));

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'discover-card';
      if (item.imageUrl) {
        const image = document.createElement('img');
        image.src = item.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        card.append(image);
      }
      const body = document.createElement('div');
      body.className = 'discover-card-body';
      const meta = document.createElement('div');
      meta.className = 'discover-card-meta';
      meta.append(message(item.type === 'note' ? 'Pengumuman' : item.type, 'discover-type'));
      if (sheetUnreadIds.has(item.id)) meta.append(message('Baru', 'discover-new'));
      const date = formattedDate(item.createdAt);
      if (date) meta.append(message(date, 'discover-date'));
      body.append(meta);
      const title = document.createElement('h3');
      title.textContent = item.title;
      body.append(title);
      if (item.description) body.append(message(item.description, 'discover-description'));
      if (item.note) body.append(message(item.note, 'discover-note'));
      if (item.link) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'discover-link';
        link.textContent = 'Buka tautan ↗';
        link.addEventListener('click', () => { void invoke('open_discover_link', { url: item.link }).catch((cause) => { error = String(cause); render(); }); });
        body.append(link);
      }
      card.append(body);
      content.append(card);
    }
  }

  async function refresh(): Promise<void> {
    if (!enabled || loading) return;
    loading = true;
    error = null;
    const currentRequest = ++requestId;
    render();
    try {
      const fetched = parseItems(await invoke<unknown>('get_discover'));
      if (!enabled || currentRequest !== requestId) return;
      items = fetched;
      const fresh = fetched.filter(item => !seenIds.has(item.id) && !announcedIds.has(item.id));
      fresh.forEach(item => announcedIds.add(item.id));
      if (!overlay.hidden) {
        fresh.forEach(item => sheetUnreadIds.add(item.id));
        markSeen();
      } else if (fresh.length) onNewItems(fresh.length);
      updateBadge();
    } catch (cause) {
      if (enabled && currentRequest === requestId) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (currentRequest === requestId) { loading = false; if (!overlay.hidden) render(); }
    }
  }

  function close(): void {
    if (overlay.hidden) return;
    overlay.hidden = true;
    sheetUnreadIds.clear();
    button.focus();
  }

  button.addEventListener('click', () => {
    if (!enabled) return;
    sheetUnreadIds.clear();
    items.filter(item => !seenIds.has(item.id)).forEach(item => sheetUnreadIds.add(item.id));
    overlay.hidden = false;
    render();
    markSeen();
    closeButton.focus();
  });
  refreshButton.addEventListener('click', () => { void refresh(); });
  closeButton.addEventListener('click', close);
  overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) close(); });

  return {
    setEnabled(next: boolean): void {
      if (enabled === next) return;
      enabled = next;
      if (enabled) {
        void refresh();
        timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
      } else {
        ++requestId;
        loading = false;
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        close();
      }
    },
  };
}
