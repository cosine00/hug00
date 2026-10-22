const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../static/admin/index.html'), 'utf8');
const start = html.indexOf('function r2ReplaceFileExt(');
const end = html.indexOf('function r2CanvasToBlob(', start);
assert.ok(start >= 0 && end > start, 'HEIC upload helpers must be present');
const helpers = html.slice(start, end);

class TestBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || '';
    this.size = parts.reduce((sum, part) => sum + (part.size || String(part).length), 0);
  }
}

class TestFile extends TestBlob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

function makeContext({browserReadable, convertedBlob} = {}) {
  const converterCalls = [];
  const context = {
    Blob: TestBlob,
    File: TestFile,
    URL: {
      createObjectURL: file => file,
      revokeObjectURL() {},
    },
    Image: class {
      set src(file) {
        queueMicrotask(() => (browserReadable(file) ? this.onload() : this.onerror()));
      }
    },
    window: {
      heic2any: async options => {
        converterCalls.push(options);
        return convertedBlob || new TestBlob(['jpeg'], {type: 'image/jpeg'});
      },
    },
    queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return {context, converterCalls};
}

(async () => {
  {
    const {context, converterCalls} = makeContext({browserReadable: () => true});
    const selected = new TestFile(['jpeg'], 'iphone.HEIC', {type: 'image/jpeg', lastModified: 10});
    const result = await context.r2DecodeHeicFile(selected);
    assert.equal(result, selected, 'a browser-readable selection should bypass heic2any');
    assert.equal(converterCalls.length, 0);
  }

  for (const [name, expectedType] of [['iphone.HEIC', 'image/heic'], ['iphone.HEIF', 'image/heif']]) {
    const {context, converterCalls} = makeContext({browserReadable: () => false});
    const selected = new TestFile(['heic'], name, {type: 'image/jpeg', lastModified: 20});
    const result = await context.r2DecodeHeicFile(selected);
    assert.equal(converterCalls.length, 1);
    assert.equal(converterCalls[0].blob.type, expectedType, 'mislabelled input MIME must be normalized');
    assert.equal(result.name, 'iphone.jpg');
    assert.equal(result.type, 'image/jpeg');
  }

  console.log('PASS: HEIC native decoding and MIME normalization');
})().catch(error => { console.error(error); process.exitCode = 1; });
