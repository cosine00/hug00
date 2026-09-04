const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../static/admin/index.html'), 'utf8');
function extract(start, end) { return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start))); }

async function testLatePostsResponse(leaves, fails) {
  let resolve, reject, renders = 0;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const content = { style: {}, innerHTML: '' };
  const context = {
    adminNavigationRevision: 1, postsRenderRevision: 0,
    STATE: { page: 'posts', selected: new Set(), postsLoaded: false }, CFG: { token: 'test' },
    document: { body: { classList: { remove() {} } }, getElementById(id) { return id === 'main-content' ? content : {}; } },
    syncMobileTabbar() {}, loadPosts: () => pending,
    renderPostsPageContainer: () => { renders++; }, escapeHTML: String,
  };
  vm.createContext(context);
  vm.runInContext(extract('async function renderPostsPage(', 'function toggleTagFilter('), context);
  const task = context.renderPostsPage();
  if (leaves) { context.STATE.page = 'editor'; context.adminNavigationRevision++; content.innerHTML = 'KEEP EDITOR'; }
  if (fails) reject(new Error('offline')); else resolve();
  await task;
  assert.equal(renders, !leaves && !fails ? 1 : 0);
  if (leaves) assert.equal(content.innerHTML, 'KEEP EDITOR');
  if (!fails) assert.equal(context.STATE.postsLoaded, true, 'background result still cached');
}

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.handlers = {}; this.isConnected = true; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name, handler) { this.handlers[name] = handler; }
  cloneNode() { return new Element(this.tag); }
  focus() {}
  remove() { this.isConnected = false; }
  click() { this.onclick?.(); }
}
function testGallerySwipe() {
  const gallery = Array.from({ length: 3 }, (_, i) => {
    const thumb = new Element('div');
    const photo = { src: `image-${i}.webp` };
    const item = { dataset: { mediaKey: `key-${i}` }, querySelector: () => ({ children: [new Element('button')] }) };
    thumb.querySelector = () => photo; thumb.closest = () => item;
    return thumb;
  });
  const body = new Element('body');
  const context = {
    window: { matchMedia: () => ({ matches: true }), visualViewport: { scale: 1 } },
    document: { body, querySelectorAll: () => gallery, getElementById: () => null, createElement: tag => new Element(tag) },
  };
  vm.createContext(context);
  vm.runInContext(extract('function openMobileMediaPreview(', 'function renderMediaPage('), context);
  context.openMobileMediaPreview(gallery[0]);
  const overlay = body.children[0], panel = overlay.children[0], image = panel.children[1];
  function swipe(x, y = 0) {
    image.handlers.touchstart({ touches: [{ clientX: 150, clientY: 150 }] });
    image.handlers.touchend({ touches: [], changedTouches: [{ clientX: 150 + x, clientY: 150 + y }] });
  }
  swipe(-100); assert.equal(image.src, 'image-1.webp'); assert.equal(overlay.dataset.key, 'key-1');
  swipe(100); assert.equal(image.src, 'image-0.webp');
  swipe(100); assert.equal(image.src, 'image-0.webp', 'stop at first image');
  swipe(-80, 150); assert.equal(image.src, 'image-0.webp', 'vertical scroll must not switch');
  context.window.visualViewport.scale = 2;
  swipe(-100); assert.equal(image.src, 'image-0.webp', 'zoomed image must not switch');
  context.window.visualViewport.scale = 1;
  image.handlers.touchstart({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 120, clientY: 120 }] });
  image.handlers.touchend({ touches: [], changedTouches: [{ clientX: 0, clientY: 100 }] });
  assert.equal(image.src, 'image-0.webp', 'pinch must not switch');
}

function testHiddenFileFocus() {
  const target = { matches: () => true };
  const context = { editorFilePickerOpen: false, lastMobileFocusTarget: target };
  vm.createContext(context);
  vm.runInContext(extract('function ensureMobileControlVisible(', 'let mobileFocusTimer='), context);
  // No window/document required: a file input must return before any geometry or scrolling.
  context.ensureMobileControlVisible(target);
}

(async () => {
  await testLatePostsResponse(false, false);
  await testLatePostsResponse(true, false);
  await testLatePostsResponse(true, true);
  testGallerySwipe();
  testHiddenFileFocus();
  console.log('PASS: late navigation responses, gallery swipe/bounds/zoom, hidden file focus');
})().catch(error => { console.error(error); process.exitCode = 1; });
