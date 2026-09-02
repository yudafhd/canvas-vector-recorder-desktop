import './styles.css';
import packageJson from '../package.json';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import {
  Check,
  Download,
  DownloadCloud,
  ExternalLink,
  Globe,
  Moon,
  MonitorPlay,
  Pencil,
  Pipette,
  Plus,
  RefreshCw,
  RotateCw,
  Settings2,
  Sun,
  Trash2,
  X,
  createIcons,
} from 'lucide';
import { activateLicense, licenseStatus, normalizedEmail } from './license';
import type { CanvasDetection, LicenseStatus, MicrostockSettings, SvgAsset, SvgResult, StartRecordingResult, TargetTabInfo, TargetTabsState } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const lucideIcons = { Check, Download, DownloadCloud, ExternalLink, Globe, Moon, MonitorPlay, Pencil, Pipette, Plus, RefreshCw, RotateCw, Settings2, Sun, Trash2, X };

function iconPlaceholder(name: string): HTMLElement {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function renderIcons(root: Element | Document | DocumentFragment = document): void {
  createIcons({ icons: lucideIcons, root });
}

function setIconButtonContent(button: HTMLButtonElement, icon: string, label: string, showLabel = true): void {
  const children: Node[] = [iconPlaceholder(icon)];
  if (showLabel) {
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    children.push(labelElement);
  }
  button.replaceChildren(...children);
  button.setAttribute('aria-label', label);
  renderIcons(button);
}

function handleRefreshShortcut(event: KeyboardEvent): void {
  if (event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return;
  if (event.key === 'Tab' && targetTabs.length) {
    event.preventDefault();
    event.stopPropagation();
    cycleTargetTab();
    return;
  }
  if (event.key.toLowerCase() === 'w' && activeMainTab === 'target' && activeTargetId) {
    event.preventDefault();
    event.stopPropagation();
    closeTargetTabFromUi(activeTargetId);
    return;
  }
  if (event.key.toLowerCase() !== 'r') return;
  event.preventDefault();
  event.stopPropagation();
  window.location.reload();
}

const landingView = $('landingView');
const landingStatus = $('landingStatus');
const landingQuote = $('landingQuote');
const activationView = $('activationView');
const workspaceView = $('workspaceView');
const mainTabs = $('mainTabs');
const recorderMainTab = $<HTMLButtonElement>('recorderMainTab');
const targetMainTabs = $('targetMainTabs');
const targetTabsCount = $('targetTabsCount');
const targetView = $('targetView');
const targetFrame = $<HTMLIFrameElement>('targetFrame');
const targetMainTitle = $('targetMainTitle');
const closeTargetMainTab = $<HTMLButtonElement>('closeTargetMainTab');
const activationStatus = $('activationStatus');
const copyError = $('copyError');
const workspaceStatus = $('workspaceStatus');
const updateIndicator = $('updateIndicator');
const updatePrompt = $('updatePrompt');
const updatePromptTitle = $('updatePromptTitle');
const updatePromptDescription = $('updatePromptDescription');
const updatePromptCancel = $<HTMLButtonElement>('updatePromptCancel');
const updatePromptInstall = $<HTMLButtonElement>('updatePromptInstall');
const canvasList = $('canvasList');
const svgList = $('svgList');
const appVersion = $('appVersion');
appVersion.textContent = `v${packageJson.version}`;
let currentSession: string | null = null;
let selectedCanvas: string | null = null;
let selectedSvg: string | null = null;
let lastSvg: SvgResult | null = null;
let targetOpen = false;
const isWindows = /Windows/i.test(navigator.userAgent);
const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
let downloadToastTimer: ReturnType<typeof setTimeout> | null = null;
type MainTab = 'recorder' | 'target';
const MAX_TARGET_TABS = 5;
let activeMainTab: MainTab = 'recorder';
let activeTargetId: string | null = null;
let targetTabs: TargetTabInfo[] = [];
let detectedAssets: CanvasDetection[] = [];
let detectedSvgAssets: SvgAsset[] = [];
type AssetTab = 'canvas' | 'svg';
let activeAssetTab: AssetTab = 'canvas';
let thumbnailGeneration = 0;
const thumbnailUrls = new Map<string, string>();
const thumbnailKeys = new Map<string, string>();
const thumbnailJobs = new Map<string, string>();
const svgThumbnailUrls = new Map<string, string>();
const svgThumbnailKeys = new Map<string, string>();
const THUMBNAIL_REFRESH_MS = 1200;
let thumbnailRefreshTimer: number | null = null;
let pendingThumbnailItems: CanvasDetection[] | null = null;
let renderedCanvasListKey = '\0';
let openTargetInProgress = false;
let refreshCanvasesInProgress = false;
let reloadTargetInProgress = false;
let previewUrl: string | null = null;
let previewRequest = 0;
let previewFilenameCanvasId: string | null = null;
let previewFilenameOverride: string | null = null;
let filenameOverrides: Record<string, string> = {};
const ARTWORK_SCALE_MIN = 0.5;
const ARTWORK_SCALE_MAX = 3;
const PREVIEW_ZOOM_MIN = 0.5;
const PREVIEW_ZOOM_MAX = 4;
const SETTINGS_STORAGE_KEY = 'canvas-vector-recorder.settings.v1';
const RATIO_PRESETS = new Set(['source', '1:1', '4:5', '4:3', '3:2', '2:3', '16:9']);
const PRESET_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1, height: 1 },
  '4:5': { width: 4, height: 5 },
  '4:3': { width: 4, height: 3 },
  '3:2': { width: 3, height: 2 },
  '2:3': { width: 2, height: 3 },
  '16:9': { width: 16, height: 9 },
};
const DEFAULT_CUSTOM_RATIO = { width: 1, height: 1 };
const LANDING_DURATION_MS = 8_000;
const LANDING_QUOTES = [
  ['Tidak ada yang akan berhasil kecuali kamu mulai mengerjakannya.', 'Maya Angelou'],
  ['Rintangan bagi tindakan justru memajukan tindakan. Yang menghalangi jalan menjadi jalan.', 'Marcus Aurelius'],
  ['Sendiri kita dapat melakukan sedikit; bersama kita dapat melakukan banyak.', 'Helen Keller'],
  ['Hidup seperti mengendarai sepeda. Agar seimbang, kamu harus terus bergerak.', 'Albert Einstein'],
  ['Pendidikan adalah senjata paling ampuh untuk mengubah dunia.', 'Nelson Mandela'],
  ['Tidak ada yang perlu ditakuti dalam hidup; yang perlu dilakukan adalah memahaminya.', 'Marie Curie'],
  ['Ketika seluruh dunia diam, satu suara pun bisa menjadi kuat.', 'Malala Yousafzai'],
  ['Masa depan bergantung pada apa yang kamu lakukan hari ini.', 'Mahatma Gandhi'],
  ['Satu-satunya cara melakukan pekerjaan hebat adalah mencintai pekerjaan itu.', 'Steve Jobs'],
  ['Kesempatan tidak terjadi begitu saja. Kamulah yang menciptakannya.', 'Chris Grosser'],
  ['Mulailah dari tempatmu berada. Gunakan yang kamu punya. Lakukan yang kamu bisa.', 'Arthur Ashe'],
  ['Keberhasilan adalah jumlah dari upaya kecil yang diulang setiap hari.', 'Robert Collier'],
  ['Tidak pernah terlambat untuk menjadi dirimu yang seharusnya.', 'George Eliot'],
  ['Keunggulan bukan tindakan, melainkan kebiasaan.', 'Will Durant'],
  ['Kebahagiaan hidupmu bergantung pada kualitas pikiranmu.', 'Marcus Aurelius'],
  ['Tidak ada yang bisa meredupkan cahaya yang bersinar dari dalam diri.', 'Maya Angelou'],
  ['Keberanian adalah harga yang dituntut kehidupan untuk memberi kedamaian.', 'Amelia Earhart'],
  ['Tugas kita bukan melihat samar di kejauhan, tetapi melakukan yang jelas di dekat kita.', 'Thomas Carlyle'],
  ['Kita menjadi apa yang kita lakukan berulang kali.', 'Aristoteles'],
  ['Bersikaplah setia pada hal-hal kecil, karena di sanalah kekuatanmu berada.', 'Bunda Teresa'],
  ['Mimpi tidak bekerja kecuali kamu bekerja.', 'John C. Maxwell'],
  ['Kegagalan hanyalah kesempatan untuk memulai lagi dengan lebih cerdas.', 'Henry Ford'],
  ['Jangan berhenti ketika lelah; berhentilah ketika selesai.', 'Marilyn Monroe'],
  ['Jika kamu mengubah cara memandang sesuatu, sesuatu yang kamu pandang ikut berubah.', 'Wayne Dyer'],
  ['Keberhasilan bukan akhir, kegagalan bukan kehancuran; keberanian untuk melanjutkanlah yang penting.', 'Winston Churchill'],
  ['Lakukan satu hal setiap hari yang membuatmu takut.', 'Eleanor Roosevelt'],
  ['Harapan adalah hal berbulu yang bertengger di jiwa.', 'Emily Dickinson'],
  ['Jalani hidup yang telah kamu bayangkan dengan penuh keyakinan.', 'Henry David Thoreau'],
  ['Tidak ada pencapaian besar tanpa antusiasme.', 'Ralph Waldo Emerson'],
  ['Wajahilah matahari, dan bayangan akan jatuh di belakangmu.', 'Walt Whitman'],
  ['Kita adalah apa yang kita yakini.', 'C. S. Lewis'],
  ['Hidup bukan soal menemukan dirimu; hidup soal menciptakan dirimu.', 'George Bernard Shaw'],
  ['Jadilah dirimu sendiri; orang lain sudah ada yang memiliki.', 'Oscar Wilde'],
  ['Rahasia untuk maju adalah memulai.', 'Mark Twain'],
  ['Keraguan kita hari ini dapat membatasi pencapaian kita esok hari.', 'William Shakespeare'],
  ['Tidak ada yang baik atau buruk, pikiranlah yang membuatnya demikian.', 'William Shakespeare'],
  ['Jangan biarkan apa yang tidak bisa kamu lakukan mengganggu apa yang bisa kamu lakukan.', 'John Wooden'],
  ['Sukses adalah kemampuan untuk berpindah dari kegagalan ke kegagalan tanpa kehilangan semangat.', 'Winston Churchill'],
  ['Apa yang kamu lakukan berbicara begitu keras hingga aku tak mendengar apa yang kamu katakan.', 'Ralph Waldo Emerson'],
  ['Jika ingin mengangkat dirimu, angkatlah orang lain.', 'Booker T. Washington'],
  ['Kita tidak dapat memecahkan masalah dengan cara pikir yang sama saat menciptakannya.', 'Albert Einstein'],
  ['Jangan menilai setiap hari dari panenmu, melainkan dari benih yang kamu tanam.', 'Robert Louis Stevenson'],
  ['Jika kamu dapat memimpikannya, kamu dapat mewujudkannya.', 'Walt Disney'],
  ['Kamu tidak harus hebat untuk memulai, tetapi harus memulai untuk menjadi hebat.', 'Zig Ziglar'],
  ['Satu-satunya batas untuk pencapaian esok adalah keraguan hari ini.', 'Franklin D. Roosevelt'],
  ['Hidup adalah petualangan berani atau bukan apa-apa.', 'Helen Keller'],
  ['Jangan menunggu. Waktunya tidak akan pernah benar-benar tepat.', 'Napoleon Hill'],
  ['Seseorang yang tidak pernah salah berarti tidak pernah mencoba hal baru.', 'Albert Einstein'],
  ['Semua impian dapat terwujud jika kita berani mengejarnya.', 'Walt Disney'],
  ['Kesulitan sering menyiapkan orang biasa untuk takdir luar biasa.', 'C. S. Lewis'],
  ['Belajarlah dari kemarin, hiduplah untuk hari ini, berharaplah untuk esok.', 'Albert Einstein'],
  ['Saat kamu tahu lebih baik, lakukan lebih baik.', 'Maya Angelou'],
  ['Keberanian dimulai dengan hadir dan membiarkan diri terlihat.', 'Brené Brown'],
  ['Apa pun yang dapat dipikirkan dan diyakini pikiran, dapat dicapai.', 'Napoleon Hill'],
  ['Buatlah setiap hari menjadi karya agungmu.', 'John Wooden'],
  ['Semakin keras kamu bekerja untuk sesuatu, semakin besar rasanya saat berhasil.', 'Cristiano Ronaldo'],
  ['Jangan biarkan kemarin mengambil terlalu banyak hari ini.', 'Will Rogers'],
  ['Masa depan adalah milik mereka yang percaya pada keindahan mimpi mereka.', 'Eleanor Roosevelt'],
  ['Kamu lebih berani daripada yang kamu kira, lebih kuat daripada yang terlihat, dan lebih cerdas dari yang kamu pikirkan.', 'A. A. Milne'],
  ['Tidak ada jalan pintas menuju tempat mana pun yang layak dituju.', 'Beverly Sills'],
  ['Kamu tidak pernah terlalu tua untuk menetapkan tujuan baru.', 'C. S. Lewis'],
  ['Satu tindakan kebaikan dapat menyalakan senyum di banyak hati.', 'William Wordsworth'],
  ['Hidup menyusut atau mengembang sebanding dengan keberanian seseorang.', 'Anaïs Nin'],
  ['Jadilah perubahan yang ingin kamu lihat di dunia.', 'Mahatma Gandhi'],
  ['Ubah lukamu menjadi kebijaksanaan.', 'Oprah Winfrey'],
  ['Jangan pernah menyerah pada sesuatu yang tidak bisa kamu lewati sehari tanpa memikirkannya.', 'Winston Churchill'],
  ['Kamu tidak bisa kembali dan mengubah awal, tetapi bisa mulai sekarang dan mengubah akhir.', 'C. S. Lewis'],
  ['Bekerjalah dengan gembira dan nikmati apa yang kamu lakukan.', 'Earl Nightingale'],
  ['Masa depan dimulai hari ini, bukan besok.', 'Paus Yohanes Paulus II'],
  ['Setiap ahli pernah menjadi pemula.', 'Helen Hayes'],
  ['Keberhasilan paling sering datang kepada mereka yang terlalu sibuk untuk mencarinya.', 'Henry David Thoreau'],
  ['Kamu kehilangan seratus persen peluang yang tidak kamu ambil.', 'Wayne Gretzky'],
  ['Bukan gunung yang kita taklukkan, melainkan diri kita sendiri.', 'Edmund Hillary'],
  ['Usahakan menjadi bernilai, bukan sekadar sukses.', 'Albert Einstein'],
  ['Kamu tidak harus melihat seluruh tangga; cukup ambil langkah pertama.', 'Martin Luther King Jr.'],
  ['Untuk mencapai hal besar, kita harus bermimpi sekaligus bertindak.', 'Anatole France'],
  ['Satu-satunya perjalanan yang mustahil adalah yang tidak pernah kamu mulai.', 'Tony Robbins'],
  ['Lakukan yang terbaik sampai kamu tahu lebih baik. Setelah itu, lakukan lebih baik.', 'Maya Angelou'],
  ['Jadilah begitu baik hingga mereka tidak bisa mengabaikanmu.', 'Steve Martin'],
  ['Yang terpenting adalah terus bertanya.', 'Albert Einstein'],
  ['Kesempurnaan tercapai bukan saat tak ada lagi yang ditambah, melainkan saat tak ada lagi yang bisa diambil.', 'Antoine de Saint-Exupéry'],
  ['Jika ada kesempatan tidak mengetuk, bangunlah pintu.', 'Milton Berle'],
  ['Semua yang pernah kamu inginkan ada di sisi lain dari rasa takut.', 'George Addair'],
  ['Sukses adalah menyukai diri sendiri, pekerjaanmu, dan caramu mengerjakannya.', 'Maya Angelou'],
  ['Kamu selalu lebih kuat daripada yang kamu kira.', 'A. A. Milne'],
  ['Hal besar dilakukan melalui rangkaian hal kecil yang disatukan.', 'Vincent van Gogh'],
  ['Yang membuatmu unik kemungkinan besar akan membuatmu sukses.', 'William Arruda'],
  ['Percayalah bahwa kamu bisa, dan kamu sudah setengah jalan.', 'Theodore Roosevelt'],
  ['Tidak ada yang mustahil bagi hati yang mau.', 'John Heywood'],
  ['Bukan panjangnya hidup, melainkan kedalaman hidup yang penting.', 'Ralph Waldo Emerson'],
  ['Kita harus menerima kekecewaan terbatas, tetapi tidak pernah kehilangan harapan tak terbatas.', 'Martin Luther King Jr.'],
  ['Jangan menunggu pemimpin; lakukan sendiri, orang ke orang.', 'Bunda Teresa'],
  ['Yang kita lakukan sekarang bergema dalam keabadian.', 'Marcus Aurelius'],
  ['Teruslah berenang.', 'Dory, Finding Nemo'],
  ['Lakukan, atau jangan lakukan. Tidak ada sekadar mencoba.', 'Yoda, The Empire Strikes Back'],
  ['Mengapa kita jatuh? Agar kita dapat belajar untuk bangkit lagi.', 'Alfred, Batman Begins'],
  ['Ke tak terhingga dan melampauinya!', 'Buzz Lightyear, Toy Story'],
  ['Harapan adalah hal yang baik, mungkin yang terbaik; dan hal baik tidak pernah mati.', 'Andy Dufresne, The Shawshank Redemption'],
  ['Raih hari ini. Jadikan hidupmu luar biasa.', 'John Keating, Dead Poets Society'],
  ['Optimisme adalah keyakinan yang menuntun pada pencapaian; tanpa harapan, tak ada yang dapat dilakukan.', 'Helen Keller'],
] as const;
const LAST_LANDING_QUOTE_KEY = 'canvas-vector-recorder.last-landing-quote.v1';
const THEME_STORAGE_KEY = 'canvas-vector-recorder.theme.v1';
const UPDATE_CHECK_STORAGE_KEY = 'canvas-vector-recorder.update-check.v1';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let artworkScale = 1;
let previewZoom = 1;
let previewPanX = 0;
let previewPanY = 0;
let darkMode = false;

interface PreviewPointer {
  x: number;
  y: number;
}

const previewPointers = new Map<number, PreviewPointer>();
let previewPanStart: { x: number; y: number; panX: number; panY: number } | null = null;
let previewPinchStart: { distance: number; centerX: number; centerY: number; zoom: number; panX: number; panY: number } | null = null;

interface PersistedSettings {
  ratio: string;
  customRatioWidth: number;
  customRatioHeight: number;
  minPixels: number;
  maxPixels: number;
  backgroundColor: string;
  transparentBackground: boolean;
  artworkScale: number;
  targetUrl: string;
  filenameOverrides: Record<string, string>;
}

function updateOpenTargetButton(): void {
  const button = $<HTMLButtonElement>('openTarget');
  if (targetOpen) {
    setIconButtonContent(button, 'plus', 'Buka tab baru');
    button.title = 'Buka URL sebagai tab target baru.';
    button.setAttribute('aria-label', 'Buka tab target baru');
  } else {
    setIconButtonContent(button, 'external-link', 'Buka');
    button.title = 'Buka window target';
    button.setAttribute('aria-label', 'Buka window target');
  }
}

function applyTheme(dark: boolean): void {
  darkMode = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const button = $<HTMLButtonElement>('themeToggle');
  const label = dark ? 'Aktifkan light mode' : 'Aktifkan dark mode';
  setIconButtonContent(button, dark ? 'sun' : 'moon', label);
  button.lastElementChild?.classList.add('theme-toggle-label');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(dark));
}

function loadTheme(): void {
  let storedTheme = '';
  try { storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || ''; } catch (_) { /* Storage may be disabled by the host. */ }
  applyTheme(storedTheme === 'dark');
}

function persistTheme(): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light'); } catch (_) { /* Storage may be disabled by the host. */ }
}

function showRandomLandingQuote(): void {
  let previousIndex = -1;
  try { previousIndex = Number(sessionStorage.getItem(LAST_LANDING_QUOTE_KEY)); } catch (_) { /* Storage may be disabled by the host. */ }
  let index = Math.floor(Math.random() * LANDING_QUOTES.length);
  if (LANDING_QUOTES.length > 1 && index === previousIndex) index = (index + 1) % LANDING_QUOTES.length;
  const [quote, attribution] = LANDING_QUOTES[index];
  landingQuote.textContent = `“${quote}” — ${attribution}`;
  try { sessionStorage.setItem(LAST_LANDING_QUOTE_KEY, String(index)); } catch (_) { /* Storage may be disabled by the host. */ }
}

function selectTargetTab(tabId: string): void {
  activeTargetId = tabId;
  setMainTab('target');
  void invoke('switch_target_tab', { tabId }).catch(error => status(workspaceStatus, errorMessage(error), 'error'));
}

function closeTargetTabFromUi(tabId: string): void {
  const operation = targetTabs.length <= 1
    ? closeTarget()
    : invoke('close_target_tab', { tabId });
  void operation.catch(error => status(workspaceStatus, errorMessage(error), 'error'));
}

function cycleTargetTab(): void {
  if (!targetTabs.length) return;
  const currentIndex = targetTabs.findIndex(tab => tab.id === activeTargetId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % targetTabs.length;
  selectTargetTab(targetTabs[nextIndex].id);
}

function renderTargetTabs(state: TargetTabsState): void {
  targetTabs = state.tabs;
  activeTargetId = state.active_id;
  targetOpen = targetTabs.length > 0;
  const newTargetMainTab = $<HTMLButtonElement>('newTargetMainTab');
  newTargetMainTab.disabled = targetTabs.length >= MAX_TARGET_TABS;
  newTargetMainTab.title = newTargetMainTab.disabled
    ? `Maksimal ${MAX_TARGET_TABS} tab target.`
    : 'Buka tab target baru';
  targetMainTabs.replaceChildren();
  targetMainTabs.hidden = !targetTabs.length;
  targetTabsCount.textContent = `${targetTabs.length}/${MAX_TARGET_TABS}`;
  targetTabsCount.hidden = !targetTabs.length;
  targetTabs.forEach((tab, index) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'target-tab-wrap';
    const button = document.createElement('button');
    button.className = `main-tab target-main-tab${activeMainTab === 'target' && tab.id === activeTargetId ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.targetId = tab.id;
    const tabIndex = document.createElement('span');
    tabIndex.className = 'target-tab-index';
    tabIndex.textContent = String(index + 1);
    const tabLabel = document.createElement('span');
    tabLabel.className = 'target-tab-label';
    tabLabel.textContent = tab.title || tab.url || 'Target';
    button.append(tabIndex, iconPlaceholder('globe'), tabLabel);
    renderIcons(button);
    button.title = tab.title ? `${tab.title} — ${tab.url}` : tab.url;
    button.setAttribute('aria-selected', String(activeMainTab === 'target' && tab.id === activeTargetId));
    button.addEventListener('click', () => selectTargetTab(tab.id));
    const reload = document.createElement('button');
    reload.className = 'target-tab-reload';
    reload.type = 'button';
    reload.appendChild(iconPlaceholder('rotate-cw'));
    renderIcons(reload);
    reload.title = 'Muat ulang target';
    reload.setAttribute('aria-label', `Muat ulang ${tab.title || 'target'}`);
    reload.addEventListener('click', event => {
      event.stopPropagation();
      if (reloadTargetInProgress) return;
      reloadTargetInProgress = true;
      reload.disabled = true;
      void invoke('reload_target_tab', { tabId: tab.id })
        .catch(error => status(workspaceStatus, errorMessage(error), 'error'))
        .finally(() => { reloadTargetInProgress = false; reload.disabled = false; });
    });
    const close = document.createElement('button');
    close.className = 'target-tab-close';
    close.type = 'button';
    close.appendChild(iconPlaceholder('x'));
    renderIcons(close);
    close.title = 'Tutup target';
    close.setAttribute('aria-label', `Tutup ${tab.title || 'target'}`);
    close.addEventListener('click', event => {
      event.stopPropagation();
      closeTargetTabFromUi(tab.id);
    });
    wrapper.addEventListener('auxclick', event => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      closeTargetTabFromUi(tab.id);
    });
    wrapper.append(button, reload, close);
    targetMainTabs.append(wrapper);
  });
  updateOpenTargetButton();
  if (activeMainTab === 'target' && activeTargetId) {
    targetMainTitle.textContent = targetTabs.find(tab => tab.id === activeTargetId)?.title || 'Target';
    setMainTab('target');
  }
}

function setMainTab(tab: MainTab): void {
  activeMainTab = tab;
  const showTarget = tab === 'target' && targetOpen && Boolean(activeTargetId);
  workspaceView.hidden = showTarget;
  targetView.hidden = !showTarget;
  targetView.classList.toggle('mac-target-view', isMac && showTarget);
  recorderMainTab.classList.toggle('active', !showTarget);
  recorderMainTab.setAttribute('aria-selected', String(!showTarget));
  targetTabs.forEach(target => {
    const button = targetMainTabs.querySelector<HTMLButtonElement>(`button[data-target-id="${target.id}"]`);
    if (button) {
      button.classList.toggle('active', showTarget && target.id === activeTargetId);
      button.setAttribute('aria-selected', String(showTarget && target.id === activeTargetId));
    }
  });
  if (showTarget) targetMainTitle.textContent = targetTabs.find(target => target.id === activeTargetId)?.title || 'Target';
  if (isWindows || isMac) {
    if (showTarget) {
      void invoke('set_target_view_visible', { visible: true }).catch(() => undefined);
      [0, 150, 500, 1000].forEach(delay => setTimeout(syncTargetViewBounds, delay));
    } else {
      void invoke('set_target_view_visible', { visible: false }).catch(() => undefined);
    }
  }
}

function syncTargetViewBounds(): void {
  if ((!isWindows && !isMac) || targetView.hidden) return;
  const bounds = targetFrame.getBoundingClientRect();
  void invoke('resize_target_view', {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }).catch(() => undefined);
}

function status(element: HTMLElement, message: string, tone: 'idle' | 'success' | 'error' = 'idle'): void {
  element.textContent = message; element.className = `status ${tone}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.message === 'string') return value.message;
    const entries = Object.entries(value);
    if (entries.length === 1) return errorMessage(entries[0][1]);
    try { return JSON.stringify(error); } catch (_) { return 'Terjadi kesalahan yang tidak diketahui.'; }
  }
  return String(error);
}

let updateInProgress = false;
let updateAvailable = false;
let pendingUpdateInstaller: (() => Promise<void>) | null = null;

interface UpdateCheckOptions { automatic?: boolean }

function setUpdateAvailable(available: boolean): void {
  updateAvailable = available;
  updateIndicator.hidden = !available;
  $('checkForUpdates').setAttribute('aria-label', available ? 'Update tersedia. Periksa update' : 'Periksa update');
}

function markUpdateCheckTime(): void {
  try { localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, String(Date.now())); } catch (_) { /* Storage may be disabled by the host. */ }
}

function checkForUpdatesOncePerDay(): void {
  let lastCheck = 0;
  try { lastCheck = Number(localStorage.getItem(UPDATE_CHECK_STORAGE_KEY) || 0); } catch (_) { /* Storage may be disabled by the host. */ }
  if (Number.isFinite(lastCheck) && Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
  markUpdateCheckTime();
  void checkForUpdates({ automatic: true });
}

function closeUpdatePrompt(cancelled = false): void {
  updatePrompt.hidden = true;
  pendingUpdateInstaller = null;
  if (cancelled) status(workspaceStatus, 'Update tersedia. Anda dapat menginstalnya kapan saja.');
}

function showUpdatePrompt(title: string, description: string, installer: (() => Promise<void>) | null = null): void {
  pendingUpdateInstaller = installer;
  updatePromptTitle.textContent = title;
  updatePromptDescription.textContent = description;
  updatePromptCancel.hidden = !installer;
  updatePromptInstall.textContent = installer ? 'Install sekarang' : 'Tutup';
  updatePrompt.hidden = false;
  window.requestAnimationFrame(() => updatePromptInstall.focus());
}

async function installPendingUpdate(): Promise<void> {
  if (!pendingUpdateInstaller) {
    closeUpdatePrompt();
    return;
  }
  if (updateInProgress) return;
  updateInProgress = true;
  updatePromptInstall.disabled = true;
  updatePromptCancel.disabled = true;
  updatePromptInstall.textContent = 'Menginstal…';
  try {
    await pendingUpdateInstaller();
    pendingUpdateInstaller = null;
    updatePrompt.hidden = true;
    setUpdateAvailable(false);
  } catch (error) {
    status(workspaceStatus, `Gagal menginstal update: ${errorMessage(error)}`, 'error');
  } finally {
    updateInProgress = false;
    updatePromptInstall.disabled = false;
    updatePromptCancel.disabled = false;
    updatePromptInstall.textContent = 'Install sekarang';
  }
}

async function checkForUpdates({ automatic = false }: UpdateCheckOptions = {}): Promise<void> {
  if (updateInProgress) return;
  const button = $<HTMLButtonElement>('checkForUpdates');
  const showProgress = !automatic;
  updateInProgress = true;
  markUpdateCheckTime();
  if (showProgress) {
    button.disabled = true;
    button.classList.add('is-loading');
    setIconButtonContent(button, 'refresh-cw', 'Memeriksa update…', false);
  }
  try {
    if (showProgress) status(workspaceStatus, 'Memeriksa update…');
    const update = await check({ timeout: 15_000 });
    if (!update) {
      setUpdateAvailable(false);
      if (showProgress) {
        showUpdatePrompt('Aplikasi sudah terbaru', `Anda sudah menggunakan Canvas Vector Recorder v${packageJson.version}.`);
        status(workspaceStatus, 'Aplikasi sudah versi terbaru.', 'success');
      }
      return;
    }

    setUpdateAvailable(true);
    if (automatic) return;
    const notes = update.body?.trim();
    showUpdatePrompt(`Update ${update.version} tersedia`, notes ? `Catatan:\n${notes.slice(0, 500)}` : 'Versi baru siap diunduh dan diinstal.', async () => {
      let downloadedBytes = 0;
      await update.downloadAndInstall(event => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          status(workspaceStatus, 'Menyiapkan download update…');
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          status(workspaceStatus, `Mengunduh update… ${Math.round(downloadedBytes / 1024)} KB`);
        } else if (event.event === 'Finished') {
          status(workspaceStatus, 'Update berhasil diinstal. Buka ulang aplikasi untuk menyelesaikan.', 'success');
        }
      });
    });
  } catch (error) {
    const message = errorMessage(error);
    if (!automatic) {
      if (/valid release JSON|latest\.json|release/i.test(message)) {
        status(workspaceStatus, 'Belum ada release updater yang dipublish di GitHub.', 'idle');
      } else {
        status(workspaceStatus, `Gagal memeriksa update: ${message}`, 'error');
      }
    }
  } finally {
    updateInProgress = false;
    if (showProgress) {
      button.disabled = false;
      button.classList.remove('is-loading');
      setIconButtonContent(button, 'download-cloud', 'Periksa update', false);
      setUpdateAvailable(updateAvailable);
    }
  }
}

function showDownloadToast(message: string): void {
  const toast = $('downloadToast');
  toast.textContent = message;
  toast.hidden = false;
  if (downloadToastTimer) clearTimeout(downloadToastTimer);
  downloadToastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function selectedRatioForBackend(): string {
  const selected = $<HTMLSelectElement>('ratio').value;
  if (selected !== 'custom') return selected || 'source';
  const width = Number($<HTMLInputElement>('customRatioWidth').value);
  const height = Number($<HTMLInputElement>('customRatioHeight').value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return 'source';
  return `${width}:${height}`;
}

function settings(): MicrostockSettings {
  return {
    profile: 'custom',
    ratio: selectedRatioForBackend(),
    minPixels: Number($<HTMLInputElement>('minPixels').value) * 1_000_000,
    maxPixels: Number($<HTMLInputElement>('maxPixels').value) * 1_000_000,
    backgroundColor: $<HTMLInputElement>('backgroundColor').value || '#ffffff',
    transparentBackground: $<HTMLInputElement>('transparentBackground').checked,
    artworkScale,
  };
}

function settingValidationError(): string | null {
  const ratio = $<HTMLSelectElement>('ratio').value;
  const minPixels = Number($<HTMLInputElement>('minPixels').value);
  const maxPixels = Number($<HTMLInputElement>('maxPixels').value);
  if (!Number.isFinite(minPixels) || minPixels <= 0) return 'Min MP harus lebih besar dari 0.';
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return 'Max MP harus lebih besar dari 0.';
  if (maxPixels <= minPixels) return 'Max MP harus lebih besar daripada Min MP.';
  if (ratio !== 'custom') return null;
  const width = Number($<HTMLInputElement>('customRatioWidth').value);
  const height = Number($<HTMLInputElement>('customRatioHeight').value);
  if (!Number.isInteger(width) || width < 1 || width > 10_000) return 'Lebar rasio custom harus berupa bilangan bulat 1–10.000.';
  if (!Number.isInteger(height) || height < 1 || height > 10_000) return 'Tinggi rasio custom harus berupa bilangan bulat 1–10.000.';
  return null;
}

function updateRatioControls(): void {
  const custom = $<HTMLSelectElement>('ratio').value === 'custom';
  const fields = $<HTMLDivElement>('customRatioFields');
  const help = $('ratioHelp');
  fields.hidden = !custom;
  fields.classList.toggle('is-custom', custom);
  const dimensions = custom
    ? { width: $<HTMLInputElement>('customRatioWidth').value, height: $<HTMLInputElement>('customRatioHeight').value }
    : PRESET_RATIO_DIMENSIONS[$<HTMLSelectElement>('ratio').value] || sourceRatioDimensions();
  help.hidden = custom;
  help.textContent = `Rasio ${dimensions.width} : ${dimensions.height}. Ubah salah satu nilai untuk beralih ke Custom.`;
}

function ratioDimensions(width: number, height: number): { width: number; height: number } {
  let left = Math.max(1, Math.round(width));
  let right = Math.max(1, Math.round(height));
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  const divisor = Math.max(1, left);
  return { width: Math.round(width) / divisor, height: Math.round(height) / divisor };
}

function sourceRatioDimensions(): { width: number; height: number } {
  const canvas = (selectedCanvas && detectedAssets.find(item => item.canvas_id === selectedCanvas)) || detectedAssets[0];
  return canvas && Number.isFinite(canvas.width) && Number.isFinite(canvas.height)
    ? ratioDimensions(canvas.width, canvas.height)
    : DEFAULT_CUSTOM_RATIO;
}

function syncRatioInputsFromSelection(): void {
  const selected = $<HTMLSelectElement>('ratio').value;
  if (selected === 'custom') return;
  const dimensions = selected === 'source' ? sourceRatioDimensions() : PRESET_RATIO_DIMENSIONS[selected] || DEFAULT_CUSTOM_RATIO;
  $<HTMLInputElement>('customRatioWidth').value = String(dimensions.width);
  $<HTMLInputElement>('customRatioHeight').value = String(dimensions.height);
}

function persistedSettings(): PersistedSettings {
  return {
    ratio: $<HTMLSelectElement>('ratio').value || 'source',
    customRatioWidth: Number($<HTMLInputElement>('customRatioWidth').value) || DEFAULT_CUSTOM_RATIO.width,
    customRatioHeight: Number($<HTMLInputElement>('customRatioHeight').value) || DEFAULT_CUSTOM_RATIO.height,
    minPixels: Number($<HTMLInputElement>('minPixels').value),
    maxPixels: Number($<HTMLInputElement>('maxPixels').value),
    backgroundColor: $<HTMLInputElement>('backgroundColor').value || '#ffffff',
    transparentBackground: $<HTMLInputElement>('transparentBackground').checked,
    artworkScale,
    targetUrl: $<HTMLInputElement>('targetUrl').value,
    filenameOverrides: { ...filenameOverrides },
  };
}

function persistSettingsSilently(): void {
  if (settingValidationError()) return;
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistedSettings())); } catch (_) { /* Storage may be disabled by the host. */ }
}

function loadPersistedSettings(): void {
  let stored: Partial<PersistedSettings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<PersistedSettings>;
  } catch (_) { stored = {}; }

  const storedRatio = typeof stored.ratio === 'string' ? stored.ratio : 'source';
  const customRatio = storedRatio === 'custom' || /^\d+:\d+$/.test(storedRatio);
  const ratioSelect = $<HTMLSelectElement>('ratio');
  ratioSelect.value = customRatio ? 'custom' : RATIO_PRESETS.has(storedRatio) ? storedRatio : 'source';
  if (customRatio) {
    const parts = storedRatio.split(':');
    const width = Number(stored.customRatioWidth) || Number(parts[0]) || DEFAULT_CUSTOM_RATIO.width;
    const height = Number(stored.customRatioHeight) || Number(parts[1]) || DEFAULT_CUSTOM_RATIO.height;
    $<HTMLInputElement>('customRatioWidth').value = String(Math.min(10_000, Math.max(1, Math.round(width))));
    $<HTMLInputElement>('customRatioHeight').value = String(Math.min(10_000, Math.max(1, Math.round(height))));
  }
  const minPixels = Number(stored.minPixels);
  const maxPixels = Number(stored.maxPixels);
  if (Number.isFinite(minPixels) && minPixels > 0) $<HTMLInputElement>('minPixels').value = String(minPixels);
  if (Number.isFinite(maxPixels) && maxPixels > 0) $<HTMLInputElement>('maxPixels').value = String(maxPixels);
  if (typeof stored.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.backgroundColor)) {
    $<HTMLInputElement>('backgroundColor').value = stored.backgroundColor;
  }
  if (typeof stored.transparentBackground === 'boolean') $<HTMLInputElement>('transparentBackground').checked = stored.transparentBackground;
  if (typeof stored.artworkScale === 'number' && Number.isFinite(stored.artworkScale)) {
    artworkScale = Math.round(Math.min(ARTWORK_SCALE_MAX, Math.max(ARTWORK_SCALE_MIN, stored.artworkScale)) * 100) / 100;
  }
  if (typeof stored.targetUrl === 'string') $<HTMLInputElement>('targetUrl').value = stored.targetUrl;
  filenameOverrides = {};
  if (stored.filenameOverrides && typeof stored.filenameOverrides === 'object') {
    Object.entries(stored.filenameOverrides).forEach(([canvasId, filename]) => {
      const normalized = typeof filename === 'string' ? normalizedFilename(filename) : null;
      if (normalized) filenameOverrides[canvasId] = normalized;
    });
  }
  syncRatioInputsFromSelection();
  updateRatioControls();
  syncBackgroundControls();
  syncBackgroundColorPicker();
  updateArtworkScaleControl();
  updatePreviewZoomControl();
}

function updatePreviewZoomControl(): void {
  const value = $<HTMLOutputElement>('previewZoomValue');
  value.textContent = `${Math.round(previewZoom * 100)}%`;
  $<HTMLInputElement>('previewZoomSlider').value = String(previewZoom);
  const image = $('previewStage').querySelector<HTMLImageElement>('img');
  if (image) image.style.transform = `translate3d(${previewPanX}px, ${previewPanY}px, 0) scale(${previewZoom})`;
}

function setPreviewZoomValue(value: number): void {
  const next = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value));
  previewZoom = Math.round(next * 100) / 100;
  updatePreviewZoomControl();
}

function resetPreviewView(): void {
  previewZoom = 1;
  previewPanX = 0;
  previewPanY = 0;
  previewPanStart = null;
  previewPinchStart = null;
  updatePreviewZoomControl();
}

function normalizedFilename(value: string): string | null {
  const trimmed = value.trim().split(/[\\/]/).pop()?.trim() || '';
  const safe = trimmed.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  if (!safe || safe === '.' || safe === '..') return null;
  return /\.svg$/i.test(safe) ? safe : `${safe}.svg`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function displayedFilename(): string {
  return previewFilenameOverride || lastSvg?.filename || '';
}

function updateFilenameDisplay(): void {
  const filename = displayedFilename();
  $('previewFilename').textContent = filename;
  const editButton = $<HTMLButtonElement>('editFilename');
  editButton.disabled = !filename;
  editButton.hidden = false;
}

function closeFilenameEditor(): void {
  const editor = $<HTMLFormElement>('previewFilenameEditor');
  editor.hidden = true;
  $<HTMLButtonElement>('editFilename').hidden = false;
}

function openFilenameEditor(): void {
  const filename = displayedFilename();
  if (!filename) return;
  const editor = $<HTMLFormElement>('previewFilenameEditor');
  const input = $<HTMLInputElement>('previewFilenameInput');
  input.value = filename;
  editor.hidden = false;
  $<HTMLButtonElement>('editFilename').hidden = true;
  input.focus();
  input.select();
}

function commitFilenameEdit(): void {
  const filename = normalizedFilename($<HTMLInputElement>('previewFilenameInput').value);
  if (!filename) {
    status(workspaceStatus, 'Nama file tidak boleh kosong.', 'error');
    return;
  }
  previewFilenameOverride = filename;
  if (previewFilenameCanvasId) filenameOverrides[previewFilenameCanvasId] = filename;
  if (lastSvg) lastSvg = { ...lastSvg, filename };
  persistSettingsSilently();
  updateFilenameDisplay();
  closeFilenameEditor();
  status(workspaceStatus, `Nama file diubah menjadi ${filename}.`, 'success');
}

function pointerDistance(first: PreviewPointer, second: PreviewPointer): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointerCenter(first: PreviewPointer, second: PreviewPointer): { x: number; y: number } {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function startPreviewGesture(): void {
  const pointers = Array.from(previewPointers.values());
  if (pointers.length === 1) {
    const [pointer] = pointers;
    previewPanStart = { x: pointer.x, y: pointer.y, panX: previewPanX, panY: previewPanY };
    previewPinchStart = null;
  } else if (pointers.length >= 2) {
    const [first, second] = pointers;
    const center = pointerCenter(first, second);
    previewPinchStart = {
      distance: Math.max(1, pointerDistance(first, second)),
      centerX: center.x,
      centerY: center.y,
      zoom: previewZoom,
      panX: previewPanX,
      panY: previewPanY,
    };
    previewPanStart = null;
  }
}

function updatePreviewGesture(): void {
  const pointers = Array.from(previewPointers.values());
  if (pointers.length >= 2 && previewPinchStart) {
    const [first, second] = pointers;
    const center = pointerCenter(first, second);
    const distance = Math.max(1, pointerDistance(first, second));
    const nextZoom = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, previewPinchStart.zoom * distance / previewPinchStart.distance));
    previewZoom = Math.round(nextZoom * 100) / 100;
    previewPanX = previewPinchStart.panX + center.x - previewPinchStart.centerX;
    previewPanY = previewPinchStart.panY + center.y - previewPinchStart.centerY;
    updatePreviewZoomControl();
    return;
  }
  if (pointers.length === 1 && previewPanStart) {
    const [pointer] = pointers;
    previewPanX = previewPanStart.panX + pointer.x - previewPanStart.x;
    previewPanY = previewPanStart.panY + pointer.y - previewPanStart.y;
    updatePreviewZoomControl();
  }
}

function updateArtworkScaleControl(): void {
  const value = $<HTMLOutputElement>('artworkScaleValue');
  value.textContent = `${Math.round(artworkScale * 100)}%`;
  $<HTMLInputElement>('artworkScaleSlider').value = String(artworkScale);
}

function setArtworkScaleValue(value: number): void {
  const next = Math.min(ARTWORK_SCALE_MAX, Math.max(ARTWORK_SCALE_MIN, value));
  if (Math.round(next * 100) / 100 === artworkScale) return;
  artworkScale = Math.round(next * 100) / 100;
  persistSettingsSilently();
  updateArtworkScaleControl();
  renderCanvases(detectedAssets);
  refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
}

function syncBackgroundControls(): void {
  const transparent = $<HTMLInputElement>('transparentBackground').checked;
  $<HTMLInputElement>('backgroundColor').disabled = transparent;
  $<HTMLInputElement>('backgroundColorHex').disabled = transparent;
  $<HTMLButtonElement>('pickBackgroundColor').disabled = transparent;
}

function normalizedHexColor(value: string): string | null {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function syncBackgroundColorPicker(): void {
  const color = $<HTMLInputElement>('backgroundColor').value;
  $<HTMLInputElement>('backgroundColorHex').value = color.toUpperCase();
}

type EyeDropperInstance = { open(): Promise<{ sRGBHex: string }> };
type EyeDropperConstructor = new () => EyeDropperInstance;

async function pickBackgroundColor(): Promise<void> {
  const colorInput = $<HTMLInputElement>('backgroundColor');
  try {
    const nativeColor = await invoke<string | null>('pick_screen_color');
    const color = nativeColor && normalizedHexColor(nativeColor);
    if (color) {
      colorInput.value = color;
      syncBackgroundColorPicker();
      persistSettingsSilently();
      return;
    }
  } catch (_) {
    // Continue with the WebView picker when the native picker is unavailable.
  }
  const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  if (!EyeDropper) {
    colorInput.click();
    return;
  }
  try {
    const result = await new EyeDropper().open();
    const color = normalizedHexColor(result.sRGBHex);
    if (!color) return;
    colorInput.value = color;
    syncBackgroundColorPicker();
    persistSettingsSilently();
  } catch (_) {
    // User canceled the native eyedropper.
  }
}

function thumbnailKey(item: CanvasDetection): string {
  const current = settings();
  return [item.canvas_id, item.revision, item.width, item.height, current.ratio, current.minPixels, current.maxPixels, current.backgroundColor, current.transparentBackground, current.artworkScale].join('|');
}

function svgThumbnailKey(item: SvgAsset): string {
  return [item.svg_id, item.revision, item.markup.length].join('|');
}

function canvasListKey(items: CanvasDetection[]): string {
  return [selectedCanvas, ...items
    .filter(item => item.shapes > 0 || item.gap_fillers > 0)
    .map(item => [item.canvas_id, item.width, item.height, item.shapes, item.gap_fillers, item.errors, item.state].join(':'))]
    .join('|');
}

function updateAssetTabs(): void {
  const canvasTab = $<HTMLButtonElement>('canvasAssetTab');
  const svgTab = $<HTMLButtonElement>('svgAssetTab');
  const canvasActive = activeAssetTab === 'canvas';
  canvasTab.classList.toggle('active', canvasActive);
  svgTab.classList.toggle('active', !canvasActive);
  canvasTab.setAttribute('aria-selected', String(canvasActive));
  svgTab.setAttribute('aria-selected', String(!canvasActive));
  canvasList.hidden = !canvasActive;
  svgList.hidden = canvasActive;
  $('canvasCount').textContent = String(detectedAssets.filter(item => item.shapes > 0 || item.gap_fillers > 0).length);
  $('svgCount').textContent = String(detectedSvgAssets.length);
  $('detectedCount').textContent = `${detectedAssets.filter(item => item.shapes > 0 || item.gap_fillers > 0).length} C · ${detectedSvgAssets.length} S`;
}

function scheduleThumbnailRefresh(items: CanvasDetection[]): void {
  pendingThumbnailItems = items;
  if (thumbnailRefreshTimer) return;
  thumbnailRefreshTimer = window.setTimeout(() => {
    thumbnailRefreshTimer = null;
    const latest = pendingThumbnailItems;
    pendingThumbnailItems = null;
    if (latest) renderCanvases(latest, { generateThumbnails: true });
  }, THUMBNAIL_REFRESH_MS);
}

function renderLicense(s: LicenseStatus): void {
  const badge = $('licenseBadge');
  badge.textContent = s.perpetual
    ? s.email || 'Lisensi aktif'
    : s.expires_at
      ? `Lisensi aktif sampai ${new Date(s.expires_at).toLocaleDateString()}`
      : 'Lisensi belum aktif';
  if (s.valid) {
    landingView.hidden = true;
    activationView.hidden = true;
    if (isWindows || isMac) {
      mainTabs.hidden = false;
      setMainTab(activeMainTab);
    } else {
      mainTabs.hidden = true;
      targetView.hidden = true;
      workspaceView.hidden = false;
    }
    checkForUpdatesOncePerDay();
  } else {
    landingView.hidden = false;
    landingStatus.textContent = s.message || 'Lisensi belum aktif. Silakan aktivasi untuk melanjutkan.';
    workspaceView.hidden = true;
    mainTabs.hidden = true;
    targetView.hidden = true;
    activationView.hidden = false;
    status(activationStatus, s.message || 'Lisensi belum aktif.', 'error');
  }
}

async function loadLicense(): Promise<void> {
  landingStatus.textContent = 'Memeriksa lisensi…';
  try { renderLicense(await licenseStatus()); }
  catch (error) {
    landingView.hidden = false;
    landingStatus.textContent = `Gagal memeriksa lisensi: ${errorMessage(error)}`;
    activationView.hidden = false;
    workspaceView.hidden = true;
    mainTabs.hidden = true;
    targetView.hidden = true;
    status(activationStatus, `Gagal membaca status lisensi: ${errorMessage(error)}`, 'error');
  }
}

function renderCanvases(items: CanvasDetection[], options: { generateThumbnails?: boolean } = {}): void {
  const generateThumbnails = options.generateThumbnails ?? true;
  detectedAssets = items;
  if ($<HTMLSelectElement>('ratio').value === 'source') syncRatioInputsFromSelection();
  const activeIds = new Set(items.map(item => item.canvas_id));
  thumbnailUrls.forEach((url, id) => {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url);
      thumbnailUrls.delete(id);
      thumbnailKeys.delete(id);
    }
  });
  const filtered = items.filter(item => item.shapes > 0 || item.gap_fillers > 0);
  updateAssetTabs();
  const nextListKey = canvasListKey(items);
  const listChanged = nextListKey !== renderedCanvasListKey;
  if (!filtered.length) {
    if (!listChanged) return;
    renderedCanvasListKey = nextListKey;
    canvasList.innerHTML = '<p class="muted">Belum ada Canvas. Buka target dan tunggu asset dimuat.</p>';
    return;
  }
  if (!listChanged) {
    if (generateThumbnails) {
      const generation = ++thumbnailGeneration;
      void loadThumbnails(filtered, generation);
    }
    return;
  }
  renderedCanvasListKey = nextListKey;
  const generation = generateThumbnails ? ++thumbnailGeneration : thumbnailGeneration;
  canvasList.innerHTML = filtered.map(item => `<div class="canvas-item${item.canvas_id === selectedCanvas ? ' selected' : ''}" data-canvas="${item.canvas_id}"><div class="canvas-thumb" data-thumb-canvas="${item.canvas_id}">${thumbnailUrls.has(item.canvas_id) ? `<img src="${thumbnailUrls.get(item.canvas_id)}" alt="Thumbnail Canvas">` : '<span>Memuat thumbnail…</span>'}</div><strong>Canvas · ${item.canvas_id}</strong><small>${item.width}×${item.height} · ${item.shapes} shapes · ${item.gap_fillers} strokes · ${item.errors} errors</small></div>`).join('');
  canvasList.querySelectorAll<HTMLElement>('.canvas-item').forEach(item => item.addEventListener('click', () => {
    const nextCanvas = item.dataset.canvas || null;
    if (nextCanvas !== selectedCanvas) {
      selectedCanvas = nextCanvas;
      selectedSvg = null;
      lastSvg = null;
      previewFilenameCanvasId = nextCanvas;
      previewFilenameOverride = nextCanvas ? filenameOverrides[nextCanvas] || null : null;
      closeFilenameEditor();
      updateFilenameDisplay();
    }
    renderCanvases(detectedAssets); refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
  }));
  if (generateThumbnails) void loadThumbnails(filtered, generation);
}

function renderSvgAssets(items: SvgAsset[]): void {
  detectedSvgAssets = items;
  const activeIds = new Set(items.map(item => item.svg_id));
  svgThumbnailUrls.forEach((url, id) => {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url);
      svgThumbnailUrls.delete(id);
      svgThumbnailKeys.delete(id);
    }
  });
  updateAssetTabs();
  if (!items.length) {
    svgList.innerHTML = '<p class="muted">Belum ada SVG. Tunggu hasil vectorisasi tampil di target.</p>';
    return;
  }
  svgList.innerHTML = items.map(item => `<div class="canvas-item${item.svg_id === selectedSvg ? ' selected' : ''}" data-svg="${item.svg_id}"><div class="canvas-thumb" data-thumb-svg="${item.svg_id}">${svgThumbnailUrls.has(item.svg_id) ? `<img src="${svgThumbnailUrls.get(item.svg_id)}" alt="Thumbnail ${escapeHtml(item.filename)}">` : '<span>Memuat thumbnail…</span>'}</div><strong>${escapeHtml(item.filename)}</strong><small>${Math.round(item.width)}×${Math.round(item.height)} · ${item.shapes} elemen · revisi ${item.revision}</small></div>`).join('');
  svgList.querySelectorAll<HTMLElement>('.canvas-item').forEach(item => item.addEventListener('click', () => {
    const nextSvg = item.dataset.svg || null;
    if (nextSvg !== selectedSvg) {
      selectedSvg = nextSvg;
      selectedCanvas = null;
      lastSvg = null;
      previewFilenameCanvasId = nextSvg;
      previewFilenameOverride = nextSvg ? filenameOverrides[nextSvg] || null : null;
      closeFilenameEditor();
      updateFilenameDisplay();
    }
    renderSvgAssets(detectedSvgAssets);
    refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
  }));
  loadSvgThumbnails(items);
}

function loadSvgThumbnails(items: SvgAsset[]): void {
  items.forEach(item => {
    const key = svgThumbnailKey(item);
    if (svgThumbnailKeys.get(item.svg_id) === key) return;
    const previous = svgThumbnailUrls.get(item.svg_id);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(new Blob([item.markup], { type: 'image/svg+xml' }));
    svgThumbnailUrls.set(item.svg_id, url);
    svgThumbnailKeys.set(item.svg_id, key);
    const slot = Array.from(svgList.querySelectorAll<HTMLElement>('[data-thumb-svg]')).find(element => element.dataset.thumbSvg === item.svg_id);
    if (slot) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Thumbnail ${item.filename}`;
      slot.replaceChildren(image);
    }
  });
}

async function loadThumbnails(items: CanvasDetection[], generation: number): Promise<void> {
  const itemsToLoad = items.filter(item => thumbnailKeys.get(item.canvas_id) !== thumbnailKey(item) && !thumbnailJobs.has(item.canvas_id));
  await Promise.all(itemsToLoad.map(async item => {
    const itemKey = thumbnailKey(item);
    thumbnailJobs.set(item.canvas_id, itemKey);
    try {
      const result = await invoke<SvgResult>('generate_svg', { canvasId: item.canvas_id, settings: settings() });
      const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      const current = detectedAssets.find(asset => asset.canvas_id === item.canvas_id);
      if (generation !== thumbnailGeneration || !current || thumbnailKey(current) !== itemKey) { URL.revokeObjectURL(url); return; }
      const previousUrl = thumbnailUrls.get(item.canvas_id);
      if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
      thumbnailUrls.set(item.canvas_id, url);
      thumbnailKeys.set(item.canvas_id, itemKey);
      const slot = Array.from(canvasList.querySelectorAll<HTMLElement>('[data-thumb-canvas]')).find(element => element.dataset.thumbCanvas === item.canvas_id);
      if (slot) { const image = document.createElement('img'); image.src = url; image.alt = 'Thumbnail Canvas'; slot.replaceChildren(image); }
    } catch (_) {
      const slot = Array.from(canvasList.querySelectorAll<HTMLElement>('[data-thumb-canvas]')).find(element => element.dataset.thumbCanvas === item.canvas_id);
      if (slot && generation === thumbnailGeneration && !thumbnailUrls.has(item.canvas_id)) slot.textContent = 'Preview tidak tersedia';
    } finally {
      if (thumbnailJobs.get(item.canvas_id) === itemKey) thumbnailJobs.delete(item.canvas_id);
    }
  }));
}

async function refreshCanvases(): Promise<void> {
  if (refreshCanvasesInProgress) return;
  refreshCanvasesInProgress = true;
  try {
    const [canvases, svgs] = await Promise.all([
      invoke<CanvasDetection[]>('list_canvases'),
      invoke<SvgAsset[]>('list_svg_assets'),
    ]);
    renderCanvases(canvases);
    renderSvgAssets(svgs);
  }
  finally { refreshCanvasesInProgress = false; }
}

function resetDetectedSurfaces(): void {
  if (thumbnailRefreshTimer) window.clearTimeout(thumbnailRefreshTimer);
  thumbnailRefreshTimer = null;
  pendingThumbnailItems = null;
  renderedCanvasListKey = '\0';
  previewRequest += 1;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  selectedCanvas = null;
  selectedSvg = null;
  lastSvg = null;
  previewFilenameCanvasId = null;
  previewFilenameOverride = null;
  detectedAssets = [];
  detectedSvgAssets = [];
  svgThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
  svgThumbnailUrls.clear();
  svgThumbnailKeys.clear();
  activeAssetTab = 'canvas';
  updateAssetTabs();
  previewZoom = 1;
  previewPanX = 0;
  previewPanY = 0;
  previewPointers.clear();
  previewPanStart = null;
  previewPinchStart = null;
  $('previewStage').innerHTML = '<p class="muted">Preview akan tampil setelah canvas direkam.</p>';
  updatePreviewZoomControl();
  $('previewTitle').textContent = 'Rendered Preview';
  closeFilenameEditor();
  updateFilenameDisplay();
  $('shapeCount').textContent = '—'; $('gapCount').textContent = '—'; $('errorCount').textContent = '—'; $('artboardSize').textContent = '—';
  $('exportSvg').setAttribute('disabled', 'true');
}

async function refreshPreview(): Promise<void> {
  const svgId = selectedSvg;
  if (svgId) {
    const result = await invoke<SvgResult>('generate_svg_asset', { svgId, settings: settings() });
    if (svgId !== selectedSvg) return;
    if (previewFilenameCanvasId !== svgId) {
      previewFilenameCanvasId = svgId;
      previewFilenameOverride = filenameOverrides[svgId] || null;
    }
    const filename = previewFilenameOverride || result.filename;
    lastSvg = { ...result, filename };
    const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = url;
    $('previewStage').innerHTML = `<img src="${url}" alt="SVG source preview" draggable="false">`;
    updatePreviewZoomControl();
    $('previewTitle').textContent = 'Source SVG'; updateFilenameDisplay();
    $('shapeCount').textContent = String(result.stats.shapes); $('gapCount').textContent = '—'; $('errorCount').textContent = '—';
    $('artboardSize').textContent = `${result.stats.artboard.width}×${result.stats.artboard.height}`;
    $('exportSvg').removeAttribute('disabled');
    status(workspaceStatus, 'vektor ditemukan.', 'success');
    return;
  }
  const canvasId = selectedCanvas;
  if (!canvasId) return;
  const request = ++previewRequest;
  const result = await invoke<SvgResult>('generate_svg', { canvasId, settings: settings() });
  if (request !== previewRequest || selectedCanvas !== canvasId) return;
  if (previewFilenameCanvasId !== canvasId) {
    previewFilenameCanvasId = canvasId;
    previewFilenameOverride = filenameOverrides[canvasId] || null;
  }
  const filename = previewFilenameOverride || result.filename;
  lastSvg = { ...result, filename };
  const blob = new Blob([result.svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
  $('previewStage').innerHTML = `<img src="${url}" alt="SVG preview" draggable="false">`;
  updatePreviewZoomControl();
  $('previewTitle').textContent = 'Preview SVG'; updateFilenameDisplay();
  $('shapeCount').textContent = String(result.stats.shapes); $('gapCount').textContent = String(result.stats.gap_fillers); $('errorCount').textContent = String(result.stats.errors);
  $('artboardSize').textContent = `${result.stats.artboard.width}×${result.stats.artboard.height}`;
  $('exportSvg').removeAttribute('disabled');
  status(workspaceStatus, result.error || 'SVG siap dipreview.', result.error ? 'idle' : 'success');
}

async function openTarget(): Promise<void> {
  if (openTargetInProgress) return;
  openTargetInProgress = true;
  const buttons = [
    $<HTMLButtonElement>('openTarget'),
    $<HTMLButtonElement>('newTargetMainTab'),
  ];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const url = $<HTMLInputElement>('targetUrl').value.trim();
    try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch { status(workspaceStatus, 'URL tidak valid. Gunakan http:// atau https://.', 'error'); return; }
    if (targetOpen) {
      await invoke('open_target_tab', { url });
      setMainTab('target');
      status(workspaceStatus, 'Target baru dibuka.', 'success');
      return;
    }
    await invoke('clear_recording');
    const started = await invoke<StartRecordingResult>('start_recording');
    currentSession = started.session_id;
    await invoke('open_target_url', { url, sessionId: currentSession });
    targetOpen = true;
    if (isMac) setMainTab('target');
    else activeMainTab = 'target';
    updateOpenTargetButton();
    selectedCanvas = null;
    selectedSvg = null;
    lastSvg = null;
    previewFilenameCanvasId = null;
    previewFilenameOverride = null;
    closeFilenameEditor();
    updateFilenameDisplay();
    await refreshCanvases();
    status(workspaceStatus, 'Perekam aktif di background.', 'success');
  } finally {
    openTargetInProgress = false;
    buttons[0].disabled = false;
    buttons[1].disabled = targetTabs.length >= MAX_TARGET_TABS;
  }
}

async function closeTarget(): Promise<void> {
  await invoke('close_target_window');
  targetOpen = false;
  mainTabs.hidden = !(isWindows || isMac);
  renderTargetTabs({ active_id: null, tabs: [] });
  setMainTab('recorder');
  updateOpenTargetButton();
  currentSession = null;
  resetDetectedSurfaces();
  status(workspaceStatus, 'Target ditutup. Detected direset.');
}

document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  window.addEventListener('keydown', handleRefreshShortcut);
  showRandomLandingQuote();
  loadTheme();
  loadPersistedSettings();
  updateOpenTargetButton();
  mainTabs.hidden = !(isWindows || isMac);
  if (isWindows || isMac) setMainTab('recorder');
  const activationForm = $<HTMLFormElement>('activationForm');
  const activationSubmit = activationForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  activationForm.addEventListener('submit', async event => {
    event.preventDefault(); copyError.hidden = true; const email = normalizedEmail($<HTMLInputElement>('licenseEmail').value); const code = $<HTMLTextAreaElement>('licenseCode').value.trim();
    activationForm.setAttribute('aria-busy', 'true');
    if (activationSubmit) { activationSubmit.disabled = true; activationSubmit.classList.add('is-loading'); activationSubmit.textContent = 'Mengaktifkan…'; }
    status(activationStatus, 'Memvalidasi dan mengaktifkan perangkat…');
    try {
      const activated = await activateLicense(email, code);
      if (!activated.valid) throw new Error(activated.message || 'Aktivasi tidak menyimpan lisensi.');
      renderLicense(activated);
    }
    catch (error) { const message = errorMessage(error); status(activationStatus, message, 'error'); copyError.hidden = false; copyError.onclick = () => navigator.clipboard.writeText(message); }
    finally { activationForm.removeAttribute('aria-busy'); if (activationSubmit) { activationSubmit.disabled = false; activationSubmit.classList.remove('is-loading'); activationSubmit.textContent = 'Aktivasi sekarang'; } }
  });
  recorderMainTab.addEventListener('click', () => setMainTab('recorder'));
  $('themeToggle').addEventListener('click', () => {
    applyTheme(!darkMode);
    persistTheme();
  });
  $('checkForUpdates').addEventListener('click', () => { void checkForUpdates(); });
  updatePromptCancel.addEventListener('click', () => closeUpdatePrompt(true));
  updatePromptInstall.addEventListener('click', () => { void installPendingUpdate(); });
  updatePrompt.addEventListener('click', event => { if (event.target === updatePrompt) closeUpdatePrompt(true); });
  $('mahesLink').addEventListener('click', event => {
    event.preventDefault();
    void invoke('open_mahes_app').catch(error => status(workspaceStatus, errorMessage(error), 'error'));
  });
  closeTargetMainTab.addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  window.addEventListener('resize', syncTargetViewBounds);
  $('openTarget').addEventListener('click', () => openTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('newTargetMainTab').addEventListener('click', () => openTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('closeTarget').addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('refreshSurfacesButton').addEventListener('click', () => refreshCanvases().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('canvasAssetTab').addEventListener('click', () => { activeAssetTab = 'canvas'; updateAssetTabs(); });
  $('svgAssetTab').addEventListener('click', () => { activeAssetTab = 'svg'; updateAssetTabs(); });
  $('clearSurfacesButton').addEventListener('click', async () => {
    try {
      await invoke('clear_surfaces');
      resetDetectedSurfaces();
      await refreshCanvases();
      status(workspaceStatus, 'Daftar Canvas dan SVG dibersihkan.', 'success');
    } catch (error) { status(workspaceStatus, errorMessage(error), 'error'); }
  });
  $('ratio').addEventListener('change', () => {
    syncRatioInputsFromSelection();
    updateRatioControls();
    persistSettingsSilently();
  });
  ['customRatioWidth', 'customRatioHeight', 'minPixels', 'maxPixels', 'transparentBackground'].forEach(id => {
    $(id).addEventListener('input', () => {
      if (id === 'customRatioWidth' || id === 'customRatioHeight') {
        const ratioSelect = $<HTMLSelectElement>('ratio');
        if (ratioSelect.value !== 'custom') {
          ratioSelect.value = 'custom';
          updateRatioControls();
        }
      }
      persistSettingsSilently();
    });
    $(id).addEventListener('change', () => { syncBackgroundControls(); persistSettingsSilently(); });
  });
  $<HTMLInputElement>('backgroundColor').addEventListener('input', () => {
    syncBackgroundColorPicker();
    persistSettingsSilently();
  });
  const backgroundColorHex = $<HTMLInputElement>('backgroundColorHex');
  backgroundColorHex.addEventListener('input', () => {
    const color = normalizedHexColor(backgroundColorHex.value);
    if (!color) return;
    $<HTMLInputElement>('backgroundColor').value = color;
    backgroundColorHex.value = color;
    persistSettingsSilently();
  });
  backgroundColorHex.addEventListener('blur', syncBackgroundColorPicker);
  $('pickBackgroundColor').addEventListener('click', () => { void pickBackgroundColor(); });
  $('previewZoomSlider').addEventListener('input', event => {
    setPreviewZoomValue(Number((event.currentTarget as HTMLInputElement).value));
  });
  $('editFilename').addEventListener('click', openFilenameEditor);
  $('previewFilenameEditor').addEventListener('submit', event => {
    event.preventDefault();
    commitFilenameEdit();
  });
  $('cancelFilename').addEventListener('click', closeFilenameEditor);
  const previewStage = $('previewStage');
  previewStage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    previewStage.setPointerCapture(event.pointerId);
    previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startPreviewGesture();
    previewStage.classList.add('is-interacting');
  });
  previewStage.addEventListener('pointermove', event => {
    if (!previewPointers.has(event.pointerId)) return;
    event.preventDefault();
    previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updatePreviewGesture();
  });
  const endPreviewPointer = (event: PointerEvent) => {
    previewPointers.delete(event.pointerId);
    if (previewStage.hasPointerCapture(event.pointerId)) previewStage.releasePointerCapture(event.pointerId);
    if (previewPointers.size === 1) startPreviewGesture();
    else if (previewPointers.size === 0) {
      previewPanStart = null;
      previewPinchStart = null;
      previewStage.classList.remove('is-interacting');
    }
  };
  previewStage.addEventListener('pointerup', endPreviewPointer);
  previewStage.addEventListener('pointercancel', endPreviewPointer);
  previewStage.addEventListener('dragstart', event => event.preventDefault());
  previewStage.addEventListener('wheel', event => {
    if (!previewStage.querySelector('img')) return;
    event.preventDefault();
    setPreviewZoomValue(previewZoom - event.deltaY * 0.001);
  }, { passive: false });
  $('resetPreview').addEventListener('click', resetPreviewView);
  $('artworkScaleSlider').addEventListener('input', event => {
    setArtworkScaleValue(Number((event.currentTarget as HTMLInputElement).value));
  });
  $('targetUrl').addEventListener('input', () => persistSettingsSilently());
  $('exportSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    const validationError = settingValidationError();
    if (validationError) { status(workspaceStatus, validationError, 'error'); return; }
    persistSettingsSilently();
    renderCanvases(detectedAssets);
    refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
    status(workspaceStatus, 'Pengaturan disimpan dan diterapkan.', 'success');
  });
  $('exportSvg').addEventListener('click', async () => {
    if (!lastSvg || (!selectedCanvas && !selectedSvg)) return;
    try {
      const savedPath = selectedSvg
        ? await invoke<string>('save_svg_asset', { svgId: selectedSvg, settings: settings(), filename: lastSvg.filename })
        : await invoke<string>('save_svg', { canvasId: selectedCanvas, settings: settings(), filename: lastSvg.filename });
      showDownloadToast(`Download tersimpan: ${savedPath}`);
      status(workspaceStatus, `SVG berhasil diexport: ${lastSvg.filename}`, 'success');
    } catch (error) { const message = errorMessage(error); showDownloadToast(`Export gagal: ${message}`); status(workspaceStatus, message, 'error'); }
  });
  void listen<CanvasDetection[]>('canvases-updated', event => {
    renderCanvases(event.payload, { generateThumbnails: false });
    scheduleThumbnailRefresh(event.payload);
  });
  void listen<SvgAsset[]>('svgs-updated', event => renderSvgAssets(event.payload));
  void listen<TargetTabsState>('target-tabs-updated', event => renderTargetTabs(event.payload));
  void listen<string>('recorder-error', event => status(workspaceStatus, event.payload, 'error'));
  void listen('target-closed', () => { targetOpen = false; activeTargetId = null; renderTargetTabs({ active_id: null, tabs: [] }); updateOpenTargetButton(); currentSession = null; resetDetectedSurfaces(); setMainTab('recorder'); });
  window.addEventListener('beforeunload', persistSettingsSilently);
  window.setTimeout(() => {
    void loadLicense();
  }, LANDING_DURATION_MS);
});
